#!/bin/bash
# Run only inside the workflow-owned disposable CML net-tools node.
set -eu
cat >/tmp/netsim-dhcp.sh <<'EOF'
#!/bin/sh
case "$1" in bound|renew)
 ip addr replace "$ip/${mask:-24}" dev "$interface"
 ip route replace default via "${router%% *}" dev "$interface"
 : >/etc/resolv.conf
 for address in $dns; do printf 'nameserver %s\n' "$address" >>/etc/resolv.conf; done
 ;; esac
EOF
chmod 700 /tmp/netsim-dhcp.sh
ip link set eth1 up
udhcpc -i eth1 -n -q -s /tmp/netsim-dhcp.sh
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y freeradius git build-essential libpcre2-dev libssl-dev python3-pexpect
revision=71cff5cb0f3b7e82eaca7af7e377331e408ea858
if ! test -d /opt/netsim-tacsrc/.git; then git init /opt/netsim-tacsrc; git -C /opt/netsim-tacsrc remote add origin https://github.com/MarcJHuber/event-driven-servers; fi
git -C /opt/netsim-tacsrc fetch --depth 1 origin "$revision"
git -C /opt/netsim-tacsrc checkout --detach "$revision"
(cd /opt/netsim-tacsrc && ./configure --minimum tac_plus-ng && make -j2 && make install)
ip link set eth1 down
