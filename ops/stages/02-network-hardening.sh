# shellcheck shell=bash
# Sourced by stage.sh. A drop-in file, so undoing it is deleting it.
# shellcheck disable=SC2034  # read by stage.sh, which sources this file
title="kernel network settings, as a drop-in file"

apply() {
  mkdir -p "$ROOT/etc/sysctl.d" || return 1
  created etc/sysctl.d/90-groundwork.conf || return 1
  printf 'net.ipv4.tcp_syncookies = 1\nnet.ipv4.conf.all.rp_filter = 1\n' >"$ROOT/etc/sysctl.d/90-groundwork.conf" || return 1
}

verify() {
  grep -qx 'net.ipv4.tcp_syncookies = 1' "$ROOT/etc/sysctl.d/90-groundwork.conf" || { echo "syncookies are not on"; return 1; }
  grep -qx 'net.ipv4.conf.all.rp_filter = 1' "$ROOT/etc/sysctl.d/90-groundwork.conf" || { echo "rp_filter is not on"; return 1; }
}
