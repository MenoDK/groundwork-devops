# shellcheck shell=bash
# Sourced by stage.sh. No root login, no passwords: keys only.
# shellcheck disable=SC2034  # read by stage.sh, which sources this file
title="no root login and no passwords over ssh"

apply() {
  keep etc/ssh/sshd_config || return 1
  sed -i -E 's/^#?PermitRootLogin .*/PermitRootLogin no/; s/^#?PasswordAuthentication .*/PasswordAuthentication no/' \
    "$ROOT/etc/ssh/sshd_config" || return 1
}

verify() {
  grep -qx 'PermitRootLogin no' "$ROOT/etc/ssh/sshd_config" || { echo "PermitRootLogin is not 'no'"; return 1; }
  grep -qx 'PasswordAuthentication no' "$ROOT/etc/ssh/sshd_config" || { echo "PasswordAuthentication is not 'no'"; return 1; }
}
