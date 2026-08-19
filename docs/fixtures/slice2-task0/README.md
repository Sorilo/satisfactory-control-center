# Slice 2 sanitized live fixtures

These fixtures bind reviewed live field shapes without retaining private deployment data.

- `frm-get-power-live.json` and `frm-get-power-no-circuits.json` preserve the approved aggregate Power evidence.
- `frm-get-generators-live.json` is derived from two observed integrated Biomass Burners.
- `frm-get-power-usage-live.json` is derived from observed generator, storage, HUB, and Miner records.

All object IDs are explicitly synthetic `fixture-*` values. All coordinates and orientation values are replaced with zero. Internal URLs, credentials, session/save names, player data, geometry, colors, and other undeclared upstream fields are omitted. Adapter tests validate the reviewed subset and prove that IDs, class names, locations, unresolved production fields, and inventory class names never cross the public contract.
