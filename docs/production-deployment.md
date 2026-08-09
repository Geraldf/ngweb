# Production deployment on an existing Proxmox VM

The production package runs the React site and API in one unprivileged Docker container. Uploaded media is stored in a named Docker volume and survives container replacement.

## VM baseline

- Debian 12 or Ubuntu 24.04 VM on the chosen Proxmox node
- 2 vCPU, 2 GB RAM, and at least 10 GB free disk
- Docker Engine with the Compose plugin
- A static DHCP lease or static private IP
- SSH key access for the deployer

The VM firewall should allow SSH only from the administration network and TCP port 80 only from the private network or reverse proxy. Do not expose the Docker API.

## First deployment

Copy or clone this repository to `/opt/fuchsclan`, then run:

```sh
cd /opt/fuchsclan
cp .env.production.example .env.production
# Set CLIENT_ORIGIN to the exact private URL users will open and
# BOOKING_ADMIN_TOKEN to a long random secret (`openssl rand -hex 32`).
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose -f compose.production.yaml ps
curl --fail http://127.0.0.1/api/health
```

Open `http://VM_PRIVATE_IP/` from the private network. If a reverse proxy provides HTTPS, set `BIND_ADDRESS` to the VM address reachable by that proxy, set `CLIENT_ORIGIN` to the HTTPS URL, and forward to port 80.

## Updates and rollback

Before an update, back up the media volume. Then update the checked-out revision and rebuild:

```sh
docker compose -f compose.production.yaml up -d --build
curl --fail http://127.0.0.1/api/health
```

To roll back, check out the previously deployed revision and run the same Compose command. The named media volume is retained. Do not run `docker compose down --volumes` unless permanent media deletion is intended.

## Backup

Back up the `media_data` Docker volume on the VM to storage outside that VM. Test restoration periodically; image metadata and uploaded files are both inside `/app/data/media`.
