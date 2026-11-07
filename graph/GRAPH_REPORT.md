# Graph Report - Antigravity  (2026-11-07)

## Corpus Check
- 22 files · ~70,583 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 3 file(s) not represented in the graph (top: (none) 2, .dat 1)

## Summary
- 347 nodes · 709 edges · 9 communities (8 shown, 1 thin omitted)
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 102 edges (avg confidence: 0.85)
- Token cost: 1,600 input · 2,000 output

## Community Hubs (Navigation)
- Agent ID Security Guard
- Bobbie Application State
- Agent Arena Mint & Bowl
- Kart CLI Contract Operations
- NullSector Mint Terminal
- TRACE & WeZards Mint Engines
- NullSector Canvas & Boot
- Agent Identity & Visual Cards

## God Nodes (most connected - your core abstractions)
1. `die()` - 22 edges
2. `mt()` - 17 edges
3. `api()` - 13 edges
4. `Z()` - 12 edges
5. `Q()` - 12 edges
6. `pt()` - 12 edges
7. `checkCall()` - 12 edges
8. `refresh()` - 11 edges
9. `jt()` - 11 edges
10. `It()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `BONBO.AI On-Chain Agent Identity Badge` --semantically_similar_to--> `Identity is Your Alpha Manifesto`  [INFERRED] [semantically similar]
  agent-card-preview.svg → scratch/tracea.html
- `Oe()` --indirect_call--> `N()`  [INFERRED]
  scratch/bobbie_app.js → scratch/tracea_page.js
- `pt()` --indirect_call--> `n()`  [INFERRED]
  scratch/bobbie_app.js → scratch/tracea_config.js
- `mt()` --indirect_call--> `n()`  [INFERRED]
  scratch/bobbie_app.js → scratch/tracea_config.js
- `mt()` --indirect_call--> `o()`  [INFERRED]
  scratch/bobbie_app.js → scratch/tracea_config.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Agentic NFT Free Mint Web Interfaces** — scratch_mint_page_portal, scratch_nullsector_terminal, scratch_tracea_mint_interface, scratch_wezards_mint_portal [INFERRED 0.95]
- **AI Agent On-Chain Interaction & Prompt Protocols** — scratch_mint_page_agent_prompt, scratch_nullsector_agent_prompt, scratch_wezards_mint_assistant, scratch_tracea_mint_workflow [INFERRED 0.85]

## Communities (9 total, 1 thin omitted)

### Community 0 - "Agent ID Security Guard"
Cohesion: 0.05
Nodes (71): agentIdOf(), agentLabel(), apiProblem(), isLocalApi(), answerChallenge(), API, api(), argv (+63 more)

### Community 1 - "Bobbie Application State"
Cohesion: 0.07
Nodes (62): at(), bt(), Ce(), ct(), De(), $e(), Ee(), en() (+54 more)

### Community 2 - "Agent Arena Mint & Bowl"
Cohesion: 0.06
Nodes (49): burst(), burstBowl(), burstSeat(), checkBtn, closeStand(), copyBtn, ctx, cv (+41 more)

### Community 3 - "Kart CLI Contract Operations"
Cohesion: 0.09
Nodes (39): addr(), ARGS, BITS, ceilingProblem(), chain, checkCall(), decodeCall(), describeCall() (+31 more)

### Community 4 - "NullSector Mint Terminal"
Cohesion: 0.11
Nodes (28): buildDisplay(), fmt(), fmtFull(), goSearch(), listedCard(), loadAllOffers(), loadMarket(), loadPal() (+20 more)

### Community 5 - "TRACE & WeZards Mint Engines"
Cohesion: 0.11
Nodes (25): vt(), d(), n(), o(), r(), s(), Legacy TRACE NFT Migration Mechanism, TRACE Genesis Mint Interface (+17 more)

### Community 6 - "NullSector Canvas & Boot"
Cohesion: 0.11
Nodes (22): ACTORS, bootEl, bootLines, botCanvas(), drawBot(), fB(), feedEl, feedTick() (+14 more)

### Community 7 - "Agent Identity & Visual Cards"
Cohesion: 0.26
Nodes (10): BONBO.AI Agent Card Preview, BONBO.AI On-Chain Agent Identity Badge, Agent Card Visual Specification (600x840, Cinzel Font, Gradient), TRACE Character Archetypes (Monitor, Cyclops, Cube), TRACE Genesis Landing Portal, h(), j(), m() (+2 more)

## Knowledge Gaps
- **13 isolated node(s):** `$AGI Token Specification`, `WL Free & Public Paid Ladder Mechanism`, `Agent Prompt Mint Integration`, `NullSector CLI Agent Prompt Protocol`, `Session Log & Live Status Stream` (+8 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 101 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `jt()` connect `Bobbie Application State` to `Agent ID Security Guard`, `TRACE & WeZards Mint Engines`?**
  _High betweenness centrality (0.233) - this node is a cross-community bridge._
- **Are the 9 inferred relationships involving `mt()` (e.g. with `kt()` and `w()`) actually correct?**
  _`mt()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$AGI Token Specification`, `WL Free & Public Paid Ladder Mechanism`, `Agent Prompt Mint Integration` to the rest of the system?**
  _13 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Agent ID Security Guard` be split into smaller, more focused modules?**
  _Cohesion score 0.05092592592592592 - nodes in this community are weakly interconnected._
- **Why does `me()` connect `Agent ID Security Guard` to `Bobbie Application State`?**
  _High betweenness centrality (0.229) - this node is a cross-community bridge._
- **Should `Bobbie Application State` be split into smaller, more focused modules?**
  _Cohesion score 0.07370600414078675 - nodes in this community are weakly interconnected._
- **Why does `e()` connect `TRACE & WeZards Mint Engines` to `Bobbie Application State`, `Agent Identity & Visual Cards`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._