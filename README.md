# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/arnesasarizky/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/arnesasarizky/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks 172 protocols that still record no token of their own by an implied value: each protocol's TVL multiplied by the median market-cap-to-TVL multiple of token-bearing peers in its category, adjusted by a seven-day growth factor and a tokenless-age factor. The board covers all 40 protocols on the snapshot's house watchlist and reaches well below its $50M floor, and every row carries a concrete five-step farm plan with costs and timings. The dashboard is fully static — sortable, filterable, with a per-protocol valuation breakdown and the live peer set the multiples are derived from.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the frozen DefiLlama snapshot, scores every pre-token protocol with the model in `lib/model.ts`, and writes `board.json`, the dashboard's `data.js`, and `dossier.json` into the output directory, beside copies of `dashboard/` and `screenshots/`. Open `out/dashboard/index.html` in a browser to use the radar — no server and no network needed.

---

<sub>Entered on [make.fun](https://make.fun/?ref=1c1337d4&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
