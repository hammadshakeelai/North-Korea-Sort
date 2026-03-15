# North Korea Sort

A cartoon single-page sorting visualizer where Kim Jong Un watches a left-to-right checker grow a green prefix, then calls in right-side missiles to delete badly placed bars until the surviving bars are fully ordered.

## Run it

[https://hammadshakeelai.github.io/North-Korea-Sort/](https://hammadshakeelai.github.io/North-Korea-Sort/)

Open [index.html](C:\Users\HP\Documents\GitHub\North Korea Sort\index.html) directly in a browser, or serve the folder with:

```powershell
python -m http.server 8000
```

Then visit `http://localhost:8000`.

The latest version adds:

- A bar-count box so you can choose how many bars spawn.
- A speed knob to speed up or slow down the animation live.
- A flying missile that enters from the right and locks onto a random-sized group of bad bars.
- Destructive zero-swap sorting, where hit bars disappear and the survivors slide left to fill the gap.
- A `Super Nuke` button that resets the bars, deletes roughly 90% of them in one massive strike, and ends on a separate `SORT-NUKE-ED` overlay before normal runs resume.
- Procedural browser audio. Click a control once if your browser needs a gesture before sound can start.

## How the joke algorithm works

1. The checker starts on the left and paints a green prefix while adjacent bars stay in nondecreasing order.
2. The moment a bar is smaller than the bar before it, that order break becomes the next delete event.
3. The algorithm scans rightward from that break and collects bars that are still below the broken threshold.
4. A random-yield missile enters from the right and deletes one or more of those badly placed bars.
5. The hit bars disappear, the survivors slide left to fill the empty slots, and the checker restarts from the left.
6. No bars are swapped into new positions by the algorithm. It only deletes bad bars until the survivors are sorted.

More detail lives in [ALGORITHM_ANALYSIS.md](C:\Users\HP\Documents\GitHub\North Korea Sort\ALGORITHM_ANALYSIS.md).

## Bonus chaos mode

The `Super Nuke` button is a one-shot spectacle mode:

1. It spawns a fresh queue.
2. It picks a tiny already-ordered survivor subsequence.
3. One oversized bomb deletes almost everything else at once.
4. A radioactive mushroom cloud appears.
5. The run ends with `SORT-NUKE-ED`, and the next restart goes back to the normal left-scan algorithm.
