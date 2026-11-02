# Pelias Palestine geocoding evidence

Evidence date: 2026-08-08. This is a disposable, localhost-only engineering benchmark, not production sizing or legal advice. It used the unchanged 30-concept bilingual fixture (60 top-result queries), a three-candidate response limit, `lang`, country/rectangle bounds, and a fixed regional focus. No custom CSV, private Darb data, fixture record, alias overlay, or production configuration was used.

## Reproducible identity and data

The deployment followed official [Pelias Docker at `3dfa07d580416edd7a27c2d4ff5976c8c1cc6ebc`](https://github.com/pelias/docker/commit/3dfa07d580416edd7a27c2d4ff5976c8c1cc6ebc). The evaluated components were the pulled `master` images recorded below, backed by Elasticsearch 7.17.27. Pelias is modular and officially supports OSM, Who's On First and GeoNames importers ([project description](https://github.com/pelias/pelias)).

| Component | Image digest |
|---|---|
| API | `sha256:e4d5d799fb9c048f869c611139d6df7ac10777a3acf387bd52cb528bedda4d3b` |
| OpenStreetMap importer | `sha256:2fa7ad8662bfff26c6673afcb64e62d25d69e6dd8f835c5583970065bac04843` |
| Who's On First importer | `sha256:38531577171e4cf4c53ca4ced1af76c31ebdbbb7fecbfaa5f93082fb692f6da3` |
| GeoNames importer | `sha256:d2e028fd078971850528cc864c18b38b1c7bef05763dc977b558ade6c16ce801` |
| schema / PIP / Placeholder | `sha256:58af6640dc97b84b0b8cd5a2ac7628171265f55bd5ace25b2faf705c2f655734` / `sha256:bca9364835a08bc080132f6d27419d0698aed1daa6c68c0f90e524209b954899` / `sha256:a7c0cde8c11e39b621b383a270c4f6de737b1ec1cb57b25cc8b9c8dfa67deffc` |
| libpostal | `sha256:72beeef72e968a7865ad7538854d900de7aa9cf27f3de899f29c00cd4a4d96fe` |
| Elasticsearch 7.17.27 | `sha256:8aa3c622abd74192eceaf53e9a3dfd51c1a75e50ee7a537d7f912aa7f80bab05` |

Imported sources were: exact Geofabrik `israel-and-palestine-260806.osm.pbf` (`119,354,376` bytes, SHA-256 `36e45cb73d7fa584fbdf58836b615174122c32f22bf1871ec691161826af79aa`), Who's On First PS administrative/place records, and GeoNames PS. OpenAddresses, polylines and custom CSV were not imported.

OSM is ODbL and requires OSM/contributor credit and ODbL notice ([OSM copyright](https://www.openstreetmap.org/copyright)). GeoNames is CC BY and requires attribution ([GeoNames export terms](https://www.geonames.org/export/index.html)). Who's On First original structure is generally CC0, requires a license link, recommends credit, and contains source-specific attribution obligations ([WOF license description](https://github.com/whosonfirst-data/whosonfirst-data#license)). These obligations remain separate; derived-database/storage and redistribution treatment requires legal review.

## Build and runtime

The final corrected open-data import indexed `282,894` documents: OSM `275,202`, GeoNames `6,110`, and WOF `1,582`. Observed indexing/preparation stages totaled about `107.1 s` excluding downloads (Placeholder `46.505 s`, WOF `5.089 s`, GeoNames `9.661 s`, OSM `45.8 s`). Retained data used `470,668,192` bytes; Elasticsearch index data used `313,769,302` bytes.

Serving memory was about `3.85 GiB`: API `116.9 MiB`, Elasticsearch `1.452 GiB`, Placeholder `535.1 MiB`, PIP `326 MiB`, and libpostal `1.422 GiB`. A restart reached a useful response in `983.579 ms`; the first request after readiness was `18.863 ms`. After warm-up, 200 sequential requests had p50/p95 `13.201/29.816 ms`, maximum `45.873 ms`, zero errors. A bounded batch of 20 had p50/p95 `85.797/111.065 ms`, maximum `112.083 ms`, zero errors. Timing used `performance.now`, a five-second timeout, and nearest-rank percentiles.

## Quality

Machine-readable, per-query evidence is in [the result file](evidence/pelias-palestine-geocoding-results.json); [the complete adjudication](evidence/pelias-palestine-geocoding-adjudication.json) records human semantic review without changing a query or provider rank.

| Language | Accepted | Target | Result |
|---|---:|---:|---|
| Arabic | 10/30 (`33.3%`) | >=95% | FAIL |
| English | 15/30 (`50.0%`) | >=95% | FAIL |
| Overall | 25/60 (`41.7%`) | >=95% | FAIL |

The 35 failures aggregate to: ranking problem 12, missing Arabic name 10, incorrect admin area 6, missing source data 6, wrong campus 1. Public-data aggregation did not overcome Arabic token/name gaps, wrong-place ranking, or absent POIs. `PELIAS_OPEN_DATA_ONLY=FAIL`; no canonical public-stop overlay was tested.

## Operations and decision

Production Pelias requires coordinated importer versions, Elasticsearch lifecycle/security work, libpostal/Placeholder/PIP services, source-specific updates, index snapshots and restore tests, rebuild automation, blue/green index promotion, disk-growth alerts, query/import telemetry, and patch ownership. Complexity is `HIGH`; projected TCO is `UNRESOLVED` pending production sizing.

`P1=FAIL`, `P2=FAIL`, `P3=FAIL`, `P4=PASS`, `P5=FAIL`, `P6=UNRESOLVED`, `P7=PASS`, `P8=FAIL`, `P9=CONDITIONAL`, `P10=UNRESOLVED`.

`PELIAS_GEOCODING_CANDIDATE=FAIL`.
