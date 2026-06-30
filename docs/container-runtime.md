# Forward Importer Container

`Dockerfile.forward-importer` packages only the Forward-side importer and connector config example. It does not include
the Dynatrace app dev/build runtime.

## Build

```bash
docker build -f Dockerfile.forward-importer -t forward-dynatrace-importer:local .
```

## Validate Package

Mount a package directory and run validation without Forward credentials:

```bash
docker run --rm \
  -v "$PWD/package:/package:ro" \
  forward-dynatrace-importer:local \
  --checks /package/forward-intent-checks.json \
  --manifest /package/forward-dynatrace-manifest.json \
  --validate-only
```

## Connector Mode

Mount a non-secret connector config and inject Forward credentials from the runtime secret store:

```bash
docker run --rm \
  -e FORWARD_USER=<user> \
  -e FORWARD_PASSWORD=<password-or-token> \
  -v "/secure/path/forward-connector.config.json:/config/forward-connector.config.json:ro" \
  forward-dynatrace-importer:local \
  --config /config/forward-connector.config.json
```

Do not bake Forward credentials into the image or config file.
For signed packages, mount the trusted public key and use a config based on
`config/forward-connector.signed.config.example.json`.

For scheduled operation, use the systemd or Kubernetes templates in
[connector-runtime.md](connector-runtime.md).
