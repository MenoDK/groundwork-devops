#!/usr/bin/env bash
# Rules that restrict published ports to an allow-list, in the chain Docker actually respects. It PRINTS them; it never applies them.
#
#   firewall-docker.sh --allow-file cidrs.txt --iface eth0 [--ports 80,443] [--min-v4 10] [--min-v6 4]
#   firewall-docker.sh ... | sudo iptables-restore --noflush      (by hand, on the host, after reading it)
#
# Why DOCKER-USER: a host firewall such as UFW filters the INPUT chain, but Docker publishes a port with a DNAT rule in
# PREROUTING, so the traffic is forwarded and never reaches INPUT. With `ports: 443:443` the UFW rules are visible in
# `ufw status` and filter nothing: anybody on the internet reaches the container directly. The DOCKER-USER chain is
# evaluated before the rules Docker generates, and it is the one place this filter works.
#
# Why --min-v4: an allow-list that arrives truncated would lock the CDN out and take the site down for everyone, so a list
# shorter than a sane minimum is refused instead of applied.
#
# Check after applying: `curl -k https://<server-ip>` from OUTSIDE the allow-list must time out.
#
# Exit codes: 0 | 2 usage | 40 allowlist_too_short | 41 bad_cidr
set -euo pipefail

allow="" iface="" ports="80,443" min4=10 min6=4
while [ $# -gt 0 ]; do
  case "$1" in
    --allow-file) allow="${2:-}"; shift 2 ;;
    --iface) iface="${2:-}"; shift 2 ;;
    --ports) ports="${2:-}"; shift 2 ;;
    --min-v4) min4="${2:-}"; shift 2 ;;
    --min-v6) min6="${2:-}"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
if [ ! -f "$allow" ] || [ -z "$iface" ]; then
  echo "usage: firewall-docker.sh --allow-file FILE --iface IFACE [--ports 80,443]" >&2
  exit 2
fi
[[ "$iface" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "bad interface name" >&2; exit 2; }
[[ "$ports" =~ ^[0-9]+(,[0-9]+)*$ ]] || { echo "bad port list" >&2; exit 2; }

v4=() v6=()
while IFS= read -r line; do
  line="${line%%#*}"
  line="$(echo "$line" | tr -d '[:space:]')"
  [ -n "$line" ] || continue
  if [[ "$line" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$ ]]; then
    v4+=("$line")
  elif [[ "$line" =~ ^[0-9a-fA-F:]+/[0-9]{1,3}$ ]] && [[ "$line" == *:* ]]; then
    v6+=("$line")
  else
    echo "x bad_cidr: '$line' is not a CIDR block" >&2
    exit 41
  fi
done <"$allow"

if [ "${#v4[@]}" -lt "$min4" ] || [ "${#v6[@]}" -lt "$min6" ]; then
  echo "x allowlist_too_short: ${#v4[@]} IPv4 and ${#v6[@]} IPv6 blocks; the minimum is $min4 and $min6. Refusing to print rules that could lock everyone out." >&2
  exit 40
fi

emit() { # label, cidrs...
  local label="$1"
  shift
  printf '# %s\n*filter\n:DOCKER-USER - [0:0]\n' "$label"
  printf -- '-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN\n'
  for cidr in "$@"; do
    printf -- '-A DOCKER-USER -i %s -s %s -p tcp -m multiport --dports %s -j RETURN\n' "$iface" "$cidr" "$ports"
  done
  printf -- '-A DOCKER-USER -i %s -p tcp -m multiport --dports %s -j DROP\n' "$iface" "$ports"
  printf -- '-A DOCKER-USER -j RETURN\nCOMMIT\n'
}

emit "iptables-restore (IPv4)" "${v4[@]}"
emit "ip6tables-restore (IPv6)" "${v6[@]}"
