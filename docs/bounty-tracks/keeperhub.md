# KeeperHub

**Prize Pool:** $5,000

## About

KeeperHub is the execution and reliability layer for AI agents operating onchain. It focuses on guaranteed onchain execution with retry logic, gas optimization, private routing, and full audit trails.

KeeperHub powers Sky Protocol (formerly MakerDAO). Agents and developers can integrate via MCP and CLI, and agents can pay autonomously via x402 or MPP.

## Prize Tracks

### 💚 Best Use of KeeperHub — $4,500

**Placements:**

- 🥇 1st place: $2,500
- 🥈 2nd place: $1,500
- 🥉 3rd place: $500

This is one ranked prize pool across two focus areas.

**Focus Area 1: Best Innovative Use of KeeperHub**

- Build something novel that solves a real problem using KeeperHub's execution layer
- Valid project types include agents, workflows, dApps, dev tools, and other practical solutions
- Any meaningful use of KeeperHub (MCP server or CLI) qualifies

**Focus Area 2: Best Integration with KeeperHub**

- Build integrations so other developers can adopt KeeperHub more easily
- Suggested angles:
  - Payments: integrate KeeperHub with payment rails like x402 or MPP
  - Agent frameworks/tools: create plugins/connectors/SDK integrations for frameworks like ElizaOS, OpenClaw, LangChain, CrewAI, or others

**Judging criteria:**

- Does it work?
- Is it useful in practice (real utility over novelty)?
- Depth of KeeperHub integration
- Mergeable quality: clean code, clear docs, and working examples

## Qualification Requirements

Each submission must include:

- A working demo (live or recorded)
- A public GitHub repository with a `README` covering setup and architecture
- A brief write-up explaining the approach and how KeeperHub is used
- Project name, team members, and contact info

## Builder Feedback Bounty — $500

Up to 2 teams receive $250 each.

This bounty is separate from the main prize pool and is open to any team that uses KeeperHub during the hackathon.

Feedback must be specific and actionable, and should include at least one of:

- UX/UI friction
- Reproducible bugs with clear steps
- Documentation gaps
- Feature requests that would have made building easier

Generic praise or vague criticism does not qualify.

## Resources

- [MCP Docs](https://docs.keeperhub.com/ai-tools)
- [API Docs](https://docs.keeperhub.com/api)
- [Platform](https://app.keeperhub.com/)
- [CLI](https://docs.keeperhub.com/cli)
- [KeeperHub Documentation](https://docs.keeperhub.com/)
- [KeeperHub Links](https://keeperhub.com/links)

## Chain Slam Integration Plan

Chain Slam uses KeeperHub as the execution reliability layer for autonomous trading agents.

Flow:

1. A Contender agent publishes a `buy` or `sell` decision.
2. The backend builds a Uniswap quote/swap.
3. The execution service submits compatible approvals and swap contract calls through KeeperHub Direct Execution.
4. The backend stores KeeperHub execution ID, status, transaction hash/link, gas metadata, and errors in the match trade history.
5. The Referee updates portfolio balances only after successful execution.

Demo proof points:

- `trade_submitted` websocket event shows KeeperHub submission.
- `trade_executed` includes `keeperExecutionId`, `transactionHash`, and `transactionLink`.
- `trade_failed` preserves an audit trail without mutating balances.
- `KEEPERHUB_FEEDBACK.md` captures actionable builder feedback.
