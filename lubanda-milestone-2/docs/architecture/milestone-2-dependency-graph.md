# Milestone 2 dependency graph

```mermaid
flowchart TD
  M1["Milestone 1 contracts, graph, geometry"] --> D["Demand engine"]
  C["Typed configuration + schemas"] --> D
  D --> A["Territory allocator"]
  G["Polygon geometry + determinism"] --> A
  A --> N["Negotiation"]
  N --> P["Preliminary corridors"]
  P --> V["Blocking territory validation"]
  V --> S["Canonical serialization + SHA-256"]
  V --> X["Engineering diagnostic SVG"]
```

Production dependency direction is one-way. Tests and scripts may compose
public modules but production modules do not import test fixtures or scripts.
The Milestone 1 `spatial` module remains available but territory allocation does
not persist its runtime index.
