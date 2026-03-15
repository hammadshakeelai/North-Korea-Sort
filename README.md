# North Korea Sort

A cartoon single-page sorting visualizer where Kim Jong Un scans a bar chart from right to left, launches a flying nuke with random yield, vaporizes collateral bars, and builds a sorted survivor frontier from the right edge inward.

## Run it

Open [index.html](C:\Users\HP\Documents\GitHub\North Korea Sort\index.html) directly in a browser, or serve the folder with:

```powershell
python -m http.server 8000
```

Then visit `http://localhost:8000`.

The latest version adds:

- A bar-count box so you can choose how many bars spawn.
- A speed knob to speed up or slow down the animation live.
- A flying missile that locks onto a random-width blast zone.
- Destructive sorting from the right edge inward, where collateral bars disappear and the queue closes the gap.
- Procedural browser audio. Click a control once if your browser needs a gesture before sound can start.

## How the joke algorithm works

1. The checker starts at the right edge and verifies the suffix.
2. The tallest remaining bar is selected as the next survivor to save.
3. A random-yield missile locks onto that bar and a multi-bar blast zone around it.
4. The nuke flies across the stage, the blast-zone bars disappear, and the surviving queue closes the gap.
5. The rescued bar joins the sorted right frontier, and the process repeats until every surviving bar is placed.
