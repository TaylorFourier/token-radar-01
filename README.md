# Field Glass

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/TaylorFourier/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/TaylorFourier/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

Token launch radar for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01). `main.ts` reads a sealed DefiLlama snapshot, scores every protocol, and writes a static board.

Unlaunched protocols (no CoinGecko id and no symbol) get a launch value from TVL, seven-day TVL change, and how long the protocol has been listed without a token. Protocols that already record a token are scored on a smaller residual farm value, with the market-cap gap and the age of the listing. Bridges, exchange books, staking receipts, versioned names, and exchange-prefixed names are scaled down. The rank is not a hand-picked list of slugs.

Referral code: `n9dm78x1`

## Run locally

Node.js 22.18 or later. Nothing to install.

```bash
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

`--input` accepts the snapshot file or a directory that contains `snapshot.json`. `--output` overrides `MAKEFUN_OUTPUT_DIR`. Inside the grader, the snapshot is `/input/snapshot.json` and the output directory is `/output`.

The run writes, in order:

1. `board.json` and `data.js`
2. a copy of `dashboard/` and `screenshots/`
3. `dossier.json`, via `buildDossier` in `vendor/makefun-board.ts`, once `screenshots/` holds images

Open `out/dashboard/index.html`. The page reads `out/data.js` and does not use the network. Sort the columns, filter by lane, category, chain, or a rising seven-day change, and open a protocol for its valuation factors and farm plan.

Screenshots are not in this tree yet. Add three images under `screenshots/` (the board, a protocol detail, and a filtered view) and run the command again to produce `dossier.json`.
