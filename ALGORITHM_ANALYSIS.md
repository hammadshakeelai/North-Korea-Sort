# Algorithm Analysis

## What it is

North Korea Sort is now a zero-swap destructive sorting joke.

It does **not** move a bad bar to the end, insert it somewhere else, or swap two bars.
Instead, it keeps checking from the left and deletes bars that break the order.

## Core rule

1. Start on the left.
2. Grow a green prefix while each bar is at least as large as the bar before it.
3. When `bar[i] < bar[i - 1]`, the order is broken.
4. Use `bar[i - 1]` as the threshold.
5. Scan to the right and collect bars whose values are still below that threshold.
6. Pick a random missile yield.
7. Delete up to that many badly placed bars.
8. Let the surviving bars collapse left into the empty space.
9. Restart the scan from the left.

This repeats until the remaining bars are already in nondecreasing order.

## Why this is zero swaps

- The algorithm never exchanges the positions of two existing bars.
- The algorithm never promotes one bar into a sorted frontier.
- The only structural change is deletion.
- The left-shift you see on screen is visual compaction after removed bars disappear, not a swap operation.

So the sort finishes by shrinking the dataset into a sorted survivor list, not by rearranging every original element.

## What counts as a target

The first bad bar is the first one that is smaller than the bar immediately to its left.

After that, the algorithm looks farther right and marks more bars that are still below the same threshold.
That makes the multi-target missile logic more consistent:

- every marked bar is genuinely bad relative to the confirmed left prefix
- the random yield changes how many bad bars get deleted in one strike
- later passes handle any remaining bad bars

## Result

The final output is a sorted subsequence of the original bars that survived the missile strikes.

That means this is intentionally not a normal stable sort, not insertion sort, and not a swap-based sort at all.

## Complexity

- A single scan pass is `O(n)`.
- Because the scan restarts after each deletion wave, the worst-case comparison cost can grow toward `O(n^2)`.
- Swap count is exactly `0`.
- Deletion count is between `0` and `n - 1`, depending on how chaotic the starting bars are and how lucky the random yields are.

## Super nuke mode

The `Super Nuke` button is a separate bonus mode, not the default algorithm.

- It resets the bars first.
- It keeps only a tiny already-ordered subsequence.
- One oversized strike deletes almost everything else in a single pass.
- The ending changes to `SORT-NUKE-ED`.
- After that run, restart returns to the normal zero-swap left-scan algorithm.
