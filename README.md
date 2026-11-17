# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/nizaryadi01/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/nizaryadi01/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar: a token launch radar that reads one sealed DefiLlama snapshot of the protocol universe (758 protocols), finds the ones that record no token yet, and ranks them by implied launch value — what a token would be worth if the protocol's record stayed as it is. The value model is learned from the snapshot itself: each category's anchor is the shrunk median market-cap/TVL of its token-bearing protocols, adjusted per protocol by seven-day TVL momentum, by how long it has run with no token, and by chain breadth. Bridges and staking wrappers are set aside rather than ranked, because their asset's token already trades. The board covers all 40 watchlist protocols plus the early pre-token protocols below the $50M floor, and every row carries a concrete seven-step farm plan with costs and times, built from the protocol's own category, chains, TVL and age. The dashboard is a static page (no network) with a sortable, filterable board, a per-protocol detail view showing the model's working, an Already trading view, a Set aside view, and a model page with the learned anchor table and a live sandbox.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Then open `out/dashboard/index.html` in a browser. The program writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's data), `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Node.js 22.18 or later, standard library only; the two runs of the program write identical bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=6nr20xdb&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
