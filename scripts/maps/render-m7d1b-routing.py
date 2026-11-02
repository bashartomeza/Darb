"""Render the public M7D1B route review over roads from the exact OSM PBF.

Dependencies: matplotlib==3.10.3 and osmium==4.3.1.
The script never calls an online tile service and never reads user data.
"""

import argparse
import json
import math
import urllib.request
from pathlib import Path

import matplotlib.pyplot as plt
import osmium


def decode_polyline6(encoded):
    index = latitude = longitude = 0
    points = []
    while index < len(encoded):
        shift = result = 0
        while True:
            byte = ord(encoded[index]) - 63
            index += 1
            result |= (byte & 31) << shift
            shift += 5
            if byte < 32:
                break
        latitude += ~(result >> 1) if result & 1 else result >> 1
        shift = result = 0
        while True:
            byte = ord(encoded[index]) - 63
            index += 1
            result |= (byte & 31) << shift
            shift += 5
            if byte < 32:
                break
        longitude += ~(result >> 1) if result & 1 else result >> 1
        points.append((latitude / 1_000_000, longitude / 1_000_000))
    return points


def calculate_route(base_url, points):
    payload = json.dumps({"locations": [{"lat": lat, "lon": lon} for lat, lon in points], "costing": "auto", "units": "kilometers"}).encode()
    request = urllib.request.Request(f"{base_url.rstrip('/')}/route", data=payload, headers={"Content-Type": "application/json", "User-Agent": "Darb-M7D1B-evidence/1.0"})
    with urllib.request.urlopen(request, timeout=15) as response:
        result = json.load(response)
    decoded = []
    for leg in result["trip"]["legs"]:
        points = decode_polyline6(leg["shape"])
        decoded.extend(points if not decoded else points[1:])
    return decoded


class RoadCollector(osmium.SimpleHandler):
    levels = {"motorway": 0, "trunk": 0, "primary": 0, "secondary": 1, "tertiary": 1, "residential": 2, "unclassified": 2, "service": 2}

    def __init__(self):
        super().__init__()
        self.roads = [[], [], []]

    def way(self, way):
        highway = way.tags.get("highway")
        if highway not in self.levels:
            return
        coordinates = [(node.location.lon, node.location.lat) for node in way.nodes if node.location.valid()]
        if len(coordinates) > 1 and any(34.88 <= lon <= 35.52 and 31.43 <= lat <= 32.52 for lon, lat in coordinates):
            self.roads[self.levels[highway]].append(coordinates)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pbf", required=True, type=Path)
    parser.add_argument("--fixture", default=Path("docs/maps/fixtures/palestine-expanded-public-evidence.json"), type=Path)
    parser.add_argument("--valhalla-url", default="http://127.0.0.1:18002")
    parser.add_argument("--output", default=Path("docs/maps/evidence/osm-valhalla-palestine-routes.png"), type=Path)
    args = parser.parse_args()
    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    routes = []
    for route in fixture["routes"]:
        ordered = [fixture["route_locations"][location_id] for location_id in route["ordered_location_ids"]]
        routes.append((route["id"], ordered, calculate_route(args.valhalla_url, ordered)))

    collector = RoadCollector()
    collector.apply_file(str(args.pbf), locations=True)
    panels = [
        ("South", (35.04, 35.24, 31.47, 31.74), [0, 1, 2]),
        ("Central", (35.15, 35.49, 31.82, 32.27), [3, 4, 5, 9, 11]),
        ("North & west", (34.93, 35.34, 32.16, 32.49), [4, 6, 7, 8, 9, 10]),
    ]
    figure, axes = plt.subplots(1, 3, figsize=(18, 8), dpi=150)
    colors = plt.cm.tab20.colors
    for axis, (title, bounds, route_indexes) in zip(axes, panels):
        minimum_lon, maximum_lon, minimum_lat, maximum_lat = bounds
        for level, collection in enumerate(collector.roads):
            for coordinates in collection:
                if max(lon for lon, _ in coordinates) < minimum_lon or min(lon for lon, _ in coordinates) > maximum_lon or max(lat for _, lat in coordinates) < minimum_lat or min(lat for _, lat in coordinates) > maximum_lat:
                    continue
                axis.plot([lon for lon, _ in coordinates], [lat for _, lat in coordinates], color=["#b0b0b0", "#c8c8c8", "#e1e1e1"][level], linewidth=[0.6, 0.35, 0.18][level], zorder=1)
        for route_index in route_indexes:
            route_id, ordered, shape = routes[route_index]
            axis.plot([point[1] for point in shape], [point[0] for point in shape], linewidth=1.6, color=colors[route_index % 20], label=route_id, zorder=3)
            axis.scatter([ordered[0][1], ordered[-1][1]], [ordered[0][0], ordered[-1][0]], s=12, color=colors[route_index % 20], zorder=4)
        axis.set(xlim=(minimum_lon, maximum_lon), ylim=(minimum_lat, maximum_lat), title=title, xlabel="Longitude", ylabel="Latitude")
        axis.grid(alpha=0.15)
        axis.legend(fontsize=7, loc="best")
        axis.set_aspect(1 / max(0.1, math.cos(math.radians((minimum_lat + maximum_lat) / 2))))
    figure.suptitle("M7D1B independent expanded Valhalla review — TEST FIXTURE DATA, NOT USER LOCATION DATA", fontsize=13)
    figure.text(0.5, 0.015, "Road context and routes derived from Geofabrik OSM extract • © OpenStreetMap contributors • ODbL 1.0", ha="center", fontsize=9)
    figure.tight_layout(rect=(0, 0.035, 1, 0.95))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(args.output, bbox_inches="tight")


if __name__ == "__main__":
    main()
