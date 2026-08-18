#!/bin/bash
set -e

echo "=== Criando swap de 2GB (primeiro, para dar folga de memoria ao dnf) ==="
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
else
  echo "swapfile ja existe, pulando."
fi
free -h

echo "=== Instalando Docker (repositorio CentOS/RHEL, compativel com Oracle Linux) ==="
sudo dnf -y install dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo rpm --import https://download.docker.com/linux/centos/gpg
sudo dnf install -y --nogpgcheck docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable docker --now
sudo usermod -aG docker opc

echo "=== Liberando portas 80/443 no firewall do sistema ==="
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --reload

echo ""
echo "=== VERIFICACAO ==="
sudo docker --version
sudo docker compose version
free -h
sudo firewall-cmd --list-ports
echo "=== FIM ==="
