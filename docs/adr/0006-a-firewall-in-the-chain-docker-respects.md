# ADR 0006: A firewall in the chain Docker respects, that only prints

Status: Accepted

## Context
A published container port bypasses the host firewall most people have configured. UFW filters the `INPUT` chain; Docker
publishes a port with a DNAT rule in `PREROUTING`, so the traffic is forwarded and never reaches `INPUT`. With
`ports: 443:443` the UFW rules appear in `ufw status` and filter nothing for that port: anyone on the internet reaches the
container. A server that restricts access to a CDN's address ranges has to put the restriction where it works.

## Decision
- **The rules go in `DOCKER-USER`**, which is evaluated before the rules Docker generates and is the one place this filter
  is effective. `ops/firewall-docker.sh` takes an allow-list file, an interface and the ports, and prints
  `iptables-restore` input.
- **It prints; it never applies.** The script is used as `firewall-docker.sh … | sudo iptables-restore --noflush`, by hand, on
  the host, after reading it. Changing a firewall remotely is exactly the change that can lock the operator out.
- **It refuses a list that is too short** (`allowlist_too_short`, exit 40; minimum 10 IPv4 and 4 IPv6 blocks by default). A
  list that arrived truncated would lock the CDN out and take the site down for everyone, so a short list is an error, not
  something to apply.
- **It validates its input**: a line that is not a CIDR block is `bad_cidr`, exit 41; the interface name and the port list
  are checked against a pattern so neither can carry a shell metacharacter into the output.
- **The demo does the other half in Compose**: the published port is bound to `127.0.0.1`, so nothing outside the machine
  can reach the container at all.

## Rejected alternatives
- **UFW rules.** They look right and filter nothing for published ports. That is the problem being solved.
- **Don't publish ports; put a reverse proxy in front.** A good architecture, and it moves the question to the proxy's own
  exposure. It does not make the rule unnecessary on a host that publishes anything.
- **Apply the rules from the script.** Saves one command and removes the moment where a person reads the output.
- **Raw `nft` rules.** Fine on a host that uses nftables natively; Docker's own chains are still iptables-based on many
  systems, and the chain to hook is the same.

## Consequences
- (+) Three behaviours have a test and a mutant: a truncated list, a line that is not a CIDR, an interface name with a
  metacharacter.
- (−) **It was never applied to a live netfilter.** The tests check what it prints, not what a kernel does with it. The page
  and the README say so, and "check from outside the allow-list that the port times out" is in the script's own header.
- (−) It manages one interface and one port list. A host with several interfaces runs it once for each.
