# Terraform skeleton (NOT APPLIED)

`main.tf.example` sketches the Cloudflare Load Balancer resources from `../pools.proposed.json`.
It is an example only: resource arguments must be checked against the Cloudflare Terraform provider
version in use, the account plan must include Load Balancing, and the owner must approve. State and the
API token (scoped to Load Balancing + DNS for gobye.app) are never committed.
