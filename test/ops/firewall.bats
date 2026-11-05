#!/usr/bin/env bats
# firewall-docker.sh: it prints rules, and it refuses to print rules that could lock everyone out.

load helper

FW="$OPT/ops/firewall-docker.sh"

setup() {
  list="$BATS_TEST_TMPDIR/cidrs.txt"
  : >"$list"
  for i in $(seq 1 12); do echo "198.51.$i.0/24" >>"$list"; done      # documentation ranges
  for i in 1 2 3 4 5; do echo "2001:db8:$i::/48" >>"$list"; done
}

@test "a full list prints a DOCKER-USER chain: established traffic, the allow-list, then a drop" {
  run "$FW" --allow-file "$list" --iface eth0
  [ "$status" -eq 0 ]
  [[ "$output" == *"-A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN"* ]]
  [[ "$output" == *"-A DOCKER-USER -i eth0 -s 198.51.1.0/24 -p tcp -m multiport --dports 80,443 -j RETURN"* ]]
  [[ "$output" == *"-A DOCKER-USER -i eth0 -p tcp -m multiport --dports 80,443 -j DROP"* ]]
  [[ "$output" == *"-s 2001:db8:1::/48"* ]]
}

@test "the drop comes after every allow, never before" {
  run "$FW" --allow-file "$list" --iface eth0
  allow_last="$(grep -n -- '-s 198.51.12.0/24' <<<"$output" | head -n 1 | cut -d: -f1)"
  drop="$(grep -n -- '-j DROP' <<<"$output" | head -n 1 | cut -d: -f1)"
  [ "$allow_last" -lt "$drop" ]
}

@test "a truncated list is refused instead of printing rules that lock the CDN out" {
  head -n 3 "$list" >"$BATS_TEST_TMPDIR/short.txt"
  run "$FW" --allow-file "$BATS_TEST_TMPDIR/short.txt" --iface eth0
  [ "$status" -eq 40 ]
  [[ "$output" == *allowlist_too_short* ]]
  [[ "$output" != *"-j DROP"* ]]
}

@test "a line that is not a CIDR block is refused" {
  echo "not-an-address" >>"$list"
  run "$FW" --allow-file "$list" --iface eth0
  [ "$status" -eq 41 ]
}

@test "comments and blank lines in the list are ignored" {
  { echo "# from the provider"; echo; cat "$list"; } >"$BATS_TEST_TMPDIR/commented.txt"
  run "$FW" --allow-file "$BATS_TEST_TMPDIR/commented.txt" --iface eth0
  [ "$status" -eq 0 ]
}

@test "an interface name with a shell metacharacter is refused" {
  run "$FW" --allow-file "$list" --iface 'eth0; reboot'
  [ "$status" -eq 2 ]
}

@test "the minimums can be raised, and then a list that was enough is not" {
  run "$FW" --allow-file "$list" --iface eth0 --min-v4 20
  [ "$status" -eq 40 ]
}

@test "it only prints: nothing here talks to iptables" {
  run grep -nE '^\s*(sudo )?(iptables|ip6tables)(-restore)? ' "$FW"
  [ "$status" -ne 0 ]
}
