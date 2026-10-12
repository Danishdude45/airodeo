# Rodeo: the request is the commit

**Live demo:** https://airodeo.dev (owner PIN: `barn`)

Rodeo is a Git platform for the agent era, built on Cloudflare Workers and Artifacts.

Most ideas for "GitHub with agents" start from code: branches, diffs, pull requests, merge conflicts. Rodeo starts from the one thing that does not go stale: **what the owner asked for.**

A business owner types a change in plain English. AI riders race to build it, each on its own Artifacts fork. A judge scores every fork against checks anyone could verify by looking at the site. The owner sees before and after on their phone and taps yes. If the code moved underneath in the meantime, Rodeo does not force an old patch. It **replays the request** on the new code and makes it pass the same checks again.

The demo repo is Barn Coffee, a small café website. It is the test subject. Rodeo is the platform.

## How it works

1. **A request comes in.** "Add a Mocha for $5.25." Rodeo turns it into 2 to 4 checks, or the owner writes their own.
2. **Riders race.** Each rider is a different model on Workers AI, and each gets its own fork of the repo (`repo.fork()`). Riders work at the same time, and several requests can race at once.
3. **A judge scores every fork.** A separate, larger model checks each fork against the owner's checks. Hard safety gates run first: valid JSON, nothing cut off, the menu still loads. Ties go to the rider that changed the fewest lines.
4. **The owner reviews the result, not the code.** Before and after previews, served straight from the forks. Yes or no.
5. **Merge, or replay.** If main has not moved, the winner merges. If main moved in different files, it merges cleanly. If main moved in the **same** file, a rider rebuilds the request on the new code and has to pass the same checks again. A merge conflict becomes a re-run.
6. **The why lives in Git.** The commit message is the request. The full race (checks, every rider's score, the judge's reasons, who approved) is written to `.rodeo/intents/<id>.md` in the repo, next to the code it produced. Any Git client can read it.
7. **Undo** restores only the files that request changed, as a new commit.

## How it answers Cloudflare's questions

| Question | Rodeo's answer |
|---|---|
| How do agents know what other agents are working on? | They don't need to. Each rider has its own fork. Coordination happens at merge time, against the request. |
| What happens when they make conflicting changes? | Different files merge cleanly. Same file: the request is replayed on the new code and must pass the same checks. |
| How do you review everything they produce? | You stop reading diffs. You review outcomes against checks the owner agreed to. |
| How do you keep track of why a change was made? | The request is the commit message, and the full race is saved in `.rodeo/intents/` inside the repo. |

## The token dial

Racing costs tokens, so it is a setting, not a rule.

- **Smart race (default):** one rider goes first. If it passes every check, it wins and the other riders never start. Only when it misses do the other riders go in.
- **Full race:** all riders at once, for bigger changes.

Every request shows its token count and number of AI calls. Measured on the live demo: a smart race that passed on the first rider used about **2,100 tokens**. A full race on a similar request used about **9,900**.

## What's inside

Everything is one Worker: `src/index.js`.

- **gitlite** (about 100 lines): builds blob, tree and commit objects, writes a packfile and pushes it over Git smart HTTP (`git-receive-pack`, protocol v1). That is how riders push to their forks from inside a Worker, with no Git binary. Merges use the expected old ref, so two merges can never overwrite each other; the loser re-checks and retries.
- **Artifacts:** `create`, `fork`, `log`, `readTree`, `readBlob`, `readFile`, `createToken`, `delete`. Previews are served directly from each fork with `readFile`.
- **Workers AI:** three riders (Llama 3.3 70B, Qwen 2.5 Coder 32B, Mistral Small 3.1) and a separate judge (GPT-OSS 120B).
- **D1:** requests, lanes, activity log and the token ledger.
- **Queues:** races, merges and undos run in the background, in parallel.
- **The app:** a mobile-first web app served by the same Worker. Arena, Ledger and How it works.

Fork previews are served with a `sandbox` Content Security Policy, so code a rider writes cannot reach the app or the owner's PIN.

## Run it yourself

You need a Cloudflare account on the Workers Paid plan (Artifacts is in open beta there).

1. Create the Artifacts namespace:
   ```sh
   curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/artifacts/namespaces" \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     --json '{"namespace":"rodeo"}'
   ```
2. Create the database and queue:
   ```sh
   npx wrangler d1 create rodeo-db          # paste the id into wrangler.jsonc
   npx wrangler d1 execute rodeo-db --remote --file schema.sql
   npx wrangler queues create rodeo-jobs
   ```
3. Set your own PIN in `wrangler.jsonc`, then deploy:
   ```sh
   npx wrangler deploy
   ```
4. Create the demo repo and push the starting site (once):
   ```sh
   curl -X POST https://<your-worker>/api/setup -H "x-rodeo-pin: <your-pin>"
   ```
5. Open your Worker URL, tap the person icon, enter your PIN and send a request.

The starting site is also in `seed/` if you want to look at it.

## API

| Route | What it does |
|---|---|
| `GET /` | The app |
| `GET /api/state` | Recent requests with lane summaries and token counts |
| `GET /api/intents/:id` | One request: checks, lanes, judge results, activity log |
| `GET /api/ledger` | The main branch history |
| `GET /p/:repo/:ref/:path` | Serve a file from any fork or commit (previews) |
| `POST /api/intents` | Send a request: `{ ask, checks?, mode: "smart" \| "full" }` |
| `POST /api/intents/:id/yes` | Ship the winner |
| `POST /api/intents/:id/no` | Turn it down and delete the forks |
| `POST /api/intents/:id/undo` | Undo a merged request (7 days) |
| `POST /api/setup` | Create and seed the demo repo |
| `POST /api/reset` | Put the demo site back to the starting page (request history is kept) |

All POST routes need the `x-rodeo-pin` header.

## Honest limits

- It drives one small demo repo. Riders rewrite whole files, which is fine for a website this size and would need diff-based edits for big codebases.
- Conflicts are detected per file, not per line. Same file means replay.
- The judge is a model. It is strict and literal, and it can still be wrong. That is why the owner sees the result before anything ships.
- Replays cost extra tokens, but only when two requests really collide.

## Who built it

Jacob Malherbe. I run a marketing agency and I could not write code before AI. I call builders like me Ranchers. Rodeo was built in a chat window with Claude and deployed straight to Cloudflare.

MIT licensed.
