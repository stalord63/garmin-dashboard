# Generates grafana/dashboards/garmin.json (the provisioned "Garmin Health" Grafana dashboard).
# Edit panels here, then run:
#   python3 grafana/generate-dashboard.py grafana/dashboards/garmin.json
# Grafana picks up the new file within 30 seconds (or run: docker compose restart grafana).
import json, sys
DS = {"type": "yesoreyeram-infinity-datasource", "uid": "garmin-json"}
URL = "http://localhost:3000/public/garmin/garmin.json"
COLORS = {"sleepMin": "#7a6cf5", "sleepScore": "#9085e9", "hrv": "#1baf7a", "restingHr": "#eb6834",
          "bodyBattery": "#3987e5", "stress": "#c2417a", "steps": "#2a78d6", "intensityMin": "#eda100"}
LABEL = {"sleepMin": "Sleep", "sleepScore": "Sleep score", "hrv": "HRV", "restingHr": "Resting HR",
         "bodyBattery": "Body Battery", "stress": "Stress", "steps": "Steps", "intensityMin": "Intensity min"}
UNIT = {"sleepMin": "h", "hrv": "ms", "restingHr": "bpm", "intensityMin": "m", "steps": "locale", "sleepScore": "none", "bodyBattery": "none", "stress": "none"}

def target(keys, fmt="timeseries", root="days", ref="A"):
    cols = [{"selector": "date", "text": "Time", "type": "timestamp"}] + [{"selector": k, "text": LABEL[k], "type": "number"} for k in keys]
    return {"refId": ref, "datasource": DS, "type": "json", "source": "url", "format": fmt, "parser": "backend",
            "url": URL, "url_options": {"method": "GET", "data": ""}, "root_selector": root, "columns": cols, "filters": []}

def overrides(keys):
    return [{"matcher": {"id": "byName", "options": LABEL[k]},
             "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": COLORS[k]}}, {"id": "unit", "value": UNIT[k]}]} for k in keys]

pid = [0]
def panel(title, kind, keys, grid, desc="", **opt):
    pid[0] += 1
    p = {"id": pid[0], "type": kind, "title": title, "description": desc, "datasource": DS, "gridPos": grid,
         "targets": [target(keys)], "fieldConfig": {"defaults": {}, "overrides": overrides(keys)}, "options": {}}
    return p

panels = []
# Row 1: stats
stats = [("Sleep score", "sleepScore", "lastNotNull", [(None, "red"), (60, "orange"), (80, "green")], "Last night"),
         ("HRV", "hrv", "lastNotNull", [(None, "text")], "Last night"),
         ("Resting HR", "restingHr", "lastNotNull", [(None, "text")], "Latest"),
         ("Body Battery", "bodyBattery", "lastNotNull", [(None, "red"), (30, "orange"), (60, "green")], "Today's peak"),
         ("Stress", "stress", "mean", [(None, "green"), (26, "text"), (51, "orange"), (76, "red")], "Daily average over the range"),
         ("Steps/day", "steps", "mean", [(None, "orange"), (5000, "text"), (7500, "green")], "Includes today so far")]
for i, (title, k, calc, steps, desc) in enumerate(stats):
    p = panel(title, "stat", [k], {"x": i * 4, "y": 0, "w": 4, "h": 4})  # no description: keeps short titles from truncating
    p["fieldConfig"]["defaults"] = {"unit": UNIT[k], "decimals": 0, "color": {"mode": "thresholds"},
        "thresholds": {"mode": "absolute", "steps": [{"color": c, "value": v} for v, c in steps]}}
    p["fieldConfig"]["overrides"] = []
    p["options"] = {"reduceOptions": {"calcs": [calc], "fields": "/^(?!Time$).*/", "values": False},
                    "colorMode": "value", "graphMode": "area", "textMode": "value", "justifyMode": "center", "wideLayout": True}
    panels.append(p)

def ts(title, keys, grid, bars=False, desc="", ref=None, right=None):
    p = panel(title, "timeseries", keys, grid, desc)
    custom = {"drawStyle": "bars" if bars else "line", "fillOpacity": 85 if bars else 12, "gradientMode": "none" if bars else "opacity", "lineWidth": 1 if bars else 2,
              "pointSize": 5, "showPoints": "always" if not bars else "never", "spanNulls": False, "barAlignment": 0,
              "axisSoftMin": 0 if bars else None, "thresholdsStyle": {"mode": "dashed" if ref else "off"}}
    custom = {k: v for k, v in custom.items() if v is not None}
    p["fieldConfig"]["defaults"] = {"custom": custom, "decimals": 0}
    if ref:
        p["fieldConfig"]["defaults"]["thresholds"] = {"mode": "absolute", "steps": [{"color": "transparent", "value": None}, {"color": "#8e8e93", "value": ref}]}
    if right:
        p["fieldConfig"]["overrides"].append({"matcher": {"id": "byName", "options": LABEL[right]},
            "properties": [{"id": "custom.axisPlacement", "value": "right"}]})
    p["options"] = {"legend": {"displayMode": "list", "placement": "bottom", "showLegend": len(keys) > 1},
                    "tooltip": {"mode": "multi", "sort": "none"}}
    p["interval"] = "1d"
    return p

def hours(p):
    # Garmin gives minutes; show hours so the axis reads 0, 2, 4, 6, 8 h.
    p["transformations"] = [{"id": "calculateField", "options": {"mode": "binary", "alias": "Sleep",
        "binary": {"left": {"matcher": {"id": "byName", "options": "Sleep (min)"}}, "operator": "/", "right": {"fixed": "60"}},
        "replaceFields": False}},
        {"id": "organize", "options": {"excludeByName": {}, "renameByName": {}}}]
    p["targets"][0]["columns"][1]["text"] = "Sleep (min)"
    p["fieldConfig"]["overrides"] = [
        {"matcher": {"id": "byName", "options": "Sleep (min)"}, "properties": [{"id": "custom.hideFrom", "value": {"viz": True, "legend": True, "tooltip": True}}, {"id": "custom.axisPlacement", "value": "hidden"}]},
        {"matcher": {"id": "byName", "options": "Sleep"}, "properties": [{"id": "color", "value": {"mode": "fixed", "fixedColor": COLORS["sleepMin"]}}, {"id": "unit", "value": "h"}, {"id": "decimals", "value": 1}, {"id": "custom.axisPlacement", "value": "left"}]}]
    return p

panels += [
    hours(ts("Sleep", ["sleepMin"], {"x": 0, "y": 4, "w": 12, "h": 8}, bars=True, desc="Hours per night. Dashed line: 7 h goal", ref=7)),
    ts("Sleep score", ["sleepScore"], {"x": 12, "y": 4, "w": 12, "h": 8}, desc="Garmin 0–100. Dashed line: 80 (good)", ref=80),
    ts("HRV & resting heart rate", ["hrv", "restingHr"], {"x": 0, "y": 12, "w": 12, "h": 8}, desc="Overnight HRV (left) and resting HR (right)", right="restingHr"),
    ts("Body Battery & stress", ["bodyBattery", "stress"], {"x": 12, "y": 12, "w": 12, "h": 8}, desc="Daily Body Battery peak and average stress"),
    ts("Steps", ["steps"], {"x": 0, "y": 20, "w": 12, "h": 8}, bars=True, desc="Daily total. Dashed line: 7,500", ref=7500),
    ts("Intensity minutes", ["intensityMin"], {"x": 12, "y": 20, "w": 12, "h": 8}, bars=True, desc="Daily moderate + 2× vigorous minutes"),
]

pid[0] += 1
acts = {"id": pid[0], "type": "table", "title": "Activities", "description": "From the activities list in garmin.json", "datasource": DS,
        "gridPos": {"x": 0, "y": 28, "w": 24, "h": 8},
        "targets": [{**target([], fmt="table", root="activities"), "columns": [
            {"selector": "date", "text": "Date", "type": "string"}, {"selector": "type", "text": "Type", "type": "string"},
            {"selector": "durationMin", "text": "Duration", "type": "number"}, {"selector": "distanceKm", "text": "Distance", "type": "number"},
            {"selector": "avgHr", "text": "Avg HR", "type": "number"}, {"selector": "calories", "text": "Calories", "type": "number"}]}],
        "fieldConfig": {"defaults": {}, "overrides": [
            {"matcher": {"id": "byName", "options": "Duration"}, "properties": [{"id": "unit", "value": "m"}]},
            {"matcher": {"id": "byName", "options": "Distance"}, "properties": [{"id": "unit", "value": "lengthkm"}, {"id": "decimals", "value": 2}]},
            {"matcher": {"id": "byName", "options": "Avg HR"}, "properties": [{"id": "unit", "value": "bpm"}]}]},
        "transformations": [{"id": "organize", "options": {"indexByName": {"Date": 0, "Type": 1, "Duration": 2, "Distance": 3, "Avg HR": 4, "Calories": 5}}}],
        "options": {"showHeader": True, "sortBy": [{"displayName": "Date", "desc": True}]}}
panels.append(acts)

dash = {"uid": "garmin-health", "title": "Garmin Health", "tags": ["garmin"], "timezone": "browser", "editable": False,
        "graphTooltip": 1, "refresh": "5m", "time": {"from": "now-30d", "to": "now"}, "schemaVersion": 39, "version": 1,
        "description": "Reads public/garmin.json (written by npm run fetch / npm run dev). Generated file; edit scripts or the JSON directly.",
        "links": [], "templating": {"list": []}, "annotations": {"list": []}, "panels": panels}
for x in panels:
    if x["type"] == "stat": x["options"]["reduceOptions"]["fields"] = ""
dash["description"] = "Reads public/garmin.json (written by npm run fetch and on npm run dev) through the Infinity data source."
json.dump(dash, open(sys.argv[1], "w"), indent=2)
print(len(panels), "panels")
