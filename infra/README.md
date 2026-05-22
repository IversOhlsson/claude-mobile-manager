# Infra

Reference configs from a personal project's overlay network and cloud
bootstrap. Published here as a portfolio snapshot — secrets are omitted.

## Layout

```
infra/
├── nebula/                  # Slack's Nebula mesh VPN
│   ├── ca/                  # CA material lives here (gitignored)
│   └── nodes/
│       ├── lighthouse/      # Public rendezvous node (OCI VM)
│       ├── computer-main/   # Workstation
│       ├── computer-server/ # Home server
│       └── phone/           # Mobile client
└── terraform/               # OCI free-tier lighthouse provisioning
```

## What's NOT in the repo

The following are gitignored — see `.gitignore`:

- `nebula/ca/ca.{key,crt}` — Nebula CA. The `.key` mints any cert into
  the overlay; never commit.
- `nebula/nodes/*/*.{key,crt}` — per-node identity.
- `nebula/nodes/phone/phone-qr.png` — QR encodes the phone's private key.
- `nebula/nodes/phone/mobile-config.yaml` — phone config with inlined
  cert + private key (mobile clients don't read separate files).
- `terraform/terraform.tfvars` — OCI tenancy/user OCIDs, API key
  fingerprint, SSH pubkey, region.
- `terraform/terraform.tfstate*` — provisioned-resource state.
- `terraform/.terraform/` — provider binaries.

## Regenerating from scratch

```bash
# CA
cd nebula/ca
nebula-cert ca -name "myorg"

# Per node (repeat per host, adjust -ip and -groups)
cd ../nodes/lighthouse
nebula-cert sign -name "lighthouse" -ip "10.42.0.1/24" -groups "lighthouse"

# Terraform
cd ../../../terraform
cp terraform.tfvars.example terraform.tfvars   # then fill in OCI creds
terraform init
terraform apply
```
