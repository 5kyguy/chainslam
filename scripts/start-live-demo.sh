#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/agentslamui"
AGENTS_DIR="$ROOT_DIR/agents"
RUN_DIR="$ROOT_DIR/.agentslam-run"
BACKEND_ENV="$BACKEND_DIR/.env"
FRONTEND_ENV="$FRONTEND_DIR/.env.local"

BACKEND_PORT="${BACKEND_PORT:-8787}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
SEPOLIA_RPC_URL="${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}"
DEMO_TRADE_USD="${DEMO_TRADE_USD:-0.1}"
DEMO_ALLOWANCE_USDC="${DEMO_ALLOWANCE_USDC:-1}"
USDC_SEPOLIA="${USDC_SEPOLIA:-0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238}"
WETH_SEPOLIA="${WETH_SEPOLIA:-0xfff9976782d46cc05630d1f6ebab18b2324d6b14}"
UNISWAP_SEPOLIA_PROXY_SPENDER="${UNISWAP_SEPOLIA_PROXY_SPENDER:-0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9}"
AUTO_APPROVE="${AUTO_APPROVE:-ask}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"
ENABLE_ZEROG="${ENABLE_ZEROG:-1}"

for arg in "$@"; do
  case "$arg" in
    --approve) AUTO_APPROVE=1 ;;
    --no-approve) AUTO_APPROVE=0 ;;
    --skip-install) SKIP_INSTALL=1 ;;
    --no-zerog) ENABLE_ZEROG=0 ;;
    --help|-h)
      cat <<HELP
Usage: ./scripts/start-live-demo.sh [options]

Starts the full local Agent Slam demo stack:
  - PostgreSQL via backend/docker-compose.yml
  - backend Fastify server on :$BACKEND_PORT
  - frontend Next.js app on :$FRONTEND_PORT
  - Sepolia live Uniswap /swap mode
  - KeeperHub execution wallet + allowance preflight
  - optional 0G memory writes when credentials are present

Options:
  --approve       Automatically submit KeeperHub USDC approval if allowance is low.
  --no-approve    Never submit approval; fail with instructions if allowance is low.
  --skip-install  Do not run npm install / Python venv setup.
  --no-zerog      Set ZEROG_ENABLED=false for a cleaner KeeperHub-only run.

Environment overrides:
  FRONTEND_PORT=3001 BACKEND_PORT=8787 DEMO_TRADE_USD=0.1 DEMO_ALLOWANCE_USDC=1
HELP
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

log() {
  printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

load_backend_env() {
  set -a
  # shellcheck disable=SC1090
  source "$BACKEND_ENV"
  set +a
}

is_empty_env() {
  local value="${1:-}"
  [[ -z "$value" || "$value" == "replace-with-your-uniswap-key" ]]
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { seen = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      seen = 1
      next
    }
    { print }
    END {
      if (seen == 0) print key "=" value
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

json_field() {
  local field="$1"
  node -e "let s=''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => { const v = JSON.parse(s); const path = '$field'.split('.'); let cur = v; for (const p of path) cur = cur?.[p]; if (cur === undefined || cur === null) process.exit(1); console.log(cur); });"
}

stop_port() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    if fuser "${port}/tcp" >/dev/null 2>&1; then
      log "Stopping existing process on port $port"
      fuser -k "${port}/tcp" >/dev/null 2>&1 || true
      sleep 1
    fi
  fi
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local max="${3:-60}"
  for ((i = 1; i <= max; i += 1)); do
    if curl --max-time 2 -fsS "$url" >/dev/null 2>&1; then
      log "$label is ready: $url"
      return 0
    fi
    sleep 1
  done
  return 1
}

start_detached() {
  local dir="$1"
  local log_file="$2"
  local pid_file="$3"
  shift 3

  if command -v setsid >/dev/null 2>&1; then
    (cd "$dir" && setsid "$@" > "$log_file" 2>&1 < /dev/null & echo $! > "$pid_file")
  else
    (cd "$dir" && nohup "$@" > "$log_file" 2>&1 < /dev/null & echo $! > "$pid_file")
  fi
}

record_port_pid() {
  local port="$1"
  local pid_file="$2"
  if command -v fuser >/dev/null 2>&1; then
    local pids
    pids="$(fuser "${port}/tcp" 2>/dev/null | xargs || true)"
    if [[ -n "$pids" ]]; then
      printf '%s\n' $pids | head -n 1 > "$pid_file"
    fi
  fi
}

keeperhub_wallet() {
  node <<'NODE'
const key = process.env.KEEPERHUB_API_KEY;
const base = (process.env.KEEPERHUB_BASE_URL || "https://app.keeperhub.com/api").replace(/\/$/, "");
if (!key) {
  throw new Error("KEEPERHUB_API_KEY is empty");
}
const res = await fetch(`${base}/user`, {
  headers: {
    accept: "application/json",
    "X-API-Key": key,
    Authorization: `Bearer ${key}`,
  },
});
const text = await res.text();
if (!res.ok) {
  throw new Error(`KeeperHub /user failed: ${res.status} ${text}`);
}
const json = JSON.parse(text);
const data = json.data || json;
const wallet = data.walletAddress || data.wallet?.address;
if (!wallet) {
  throw new Error(`KeeperHub wallet address missing from /user response: ${text}`);
}
console.log(wallet);
NODE
}

wallet_state() {
  KEEPERHUB_WALLET="$1" node <<'NODE'
const wallet = process.env.KEEPERHUB_WALLET;
const rpc = process.env.SEPOLIA_RPC_URL;
const usdc = process.env.USDC_SEPOLIA;
const spender = process.env.UNISWAP_SEPOLIA_PROXY_SPENDER;
const pad = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
async function rpcCall(payload) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json.result;
}
const [ethRaw, usdcRaw, allowanceRaw] = await Promise.all([
  rpcCall({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [wallet, "latest"] }),
  rpcCall({ jsonrpc: "2.0", id: 2, method: "eth_call", params: [{ to: usdc, data: "0x70a08231" + pad(wallet) }, "latest"] }),
  rpcCall({ jsonrpc: "2.0", id: 3, method: "eth_call", params: [{ to: usdc, data: "0xdd62ed3e" + pad(wallet) + pad(spender) }, "latest"] }),
]);
console.log(JSON.stringify({
  eth: Number(BigInt(ethRaw)) / 1e18,
  usdc: Number(BigInt(usdcRaw)) / 1e6,
  allowance: Number(BigInt(allowanceRaw)) / 1e6,
}));
NODE
}

check_uniswap_quote() {
  KEEPERHUB_WALLET="$1" node <<'NODE'
const wallet = process.env.KEEPERHUB_WALLET;
const amount = String(Math.round(Number(process.env.DEMO_TRADE_USD || "0.1") * 1e6));
const body = {
  type: "EXACT_INPUT",
  amount,
  tokenIn: process.env.USDC_SEPOLIA,
  tokenOut: process.env.WETH_SEPOLIA,
  tokenInChainId: 11155111,
  tokenOutChainId: 11155111,
  swapper: wallet,
  slippageTolerance: 0.5,
};
const res = await fetch("https://trade-api.gateway.uniswap.org/v1/quote", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json",
    "x-api-key": process.env.UNISWAP_API_KEY,
    "x-universal-router-version": "2.0",
    "x-permit2-disabled": "true",
  },
  body: JSON.stringify(body),
});
const text = await res.text();
if (!res.ok) {
  throw new Error(`Uniswap Sepolia quote failed: ${res.status} ${text}`);
}
const json = JSON.parse(text);
console.log(JSON.stringify({
  requestId: json.requestId,
  routing: json.routing,
  amountOut: json.quote?.output?.amount || json.quote?.amountOut,
}));
NODE
}

submit_keeperhub_approval() {
  local amount_base_units
  amount_base_units="$(node -e "console.log(String(Math.round(Number(process.env.DEMO_ALLOWANCE_USDC || '1') * 1e6)))")"
  APPROVE_AMOUNT_BASE_UNITS="$amount_base_units" node <<'NODE'
const key = process.env.KEEPERHUB_API_KEY;
const base = (process.env.KEEPERHUB_BASE_URL || "https://app.keeperhub.com/api").replace(/\/$/, "");
const body = {
  contractAddress: process.env.USDC_SEPOLIA,
  network: "sepolia",
  functionName: "approve",
  functionArgs: JSON.stringify([
    process.env.UNISWAP_SEPOLIA_PROXY_SPENDER,
    process.env.APPROVE_AMOUNT_BASE_UNITS,
  ]),
  abi: JSON.stringify([{
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  }]),
  value: "0",
  gasLimitMultiplier: "1.2",
};
const res = await fetch(`${base}/execute/contract-call`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json",
    "X-API-Key": key,
    Authorization: `Bearer ${key}`,
  },
  body: JSON.stringify(body),
});
const text = await res.text();
if (!res.ok) {
  throw new Error(`KeeperHub approval failed: ${res.status} ${text}`);
}
console.log(text);
NODE
}

ensure_env_files() {
  if [[ ! -f "$BACKEND_ENV" ]]; then
    cp "$BACKEND_DIR/.env.example" "$BACKEND_ENV"
    cat >&2 <<EOF
Created backend/.env from backend/.env.example.
Fill these values, then run this script again:
  UNISWAP_API_KEY
  KEEPERHUB_API_KEY
  ZEROG_PRIVATE_KEY and ZEROG_KV_STREAM_ID for 0G proof mode
EOF
    exit 1
  fi

  if [[ ! -f "$FRONTEND_ENV" ]]; then
    cp "$FRONTEND_DIR/.env.example" "$FRONTEND_ENV"
  fi
}

install_deps() {
  if [[ "$SKIP_INSTALL" == "1" ]]; then
    log "Skipping dependency installation"
    return
  fi

  if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
    log "Installing backend dependencies"
    (cd "$BACKEND_DIR" && npm install)
  fi

  if [[ ! -x "$AGENTS_DIR/.venv/bin/python" ]]; then
    log "Creating Python agent venv"
    python3 -m venv "$AGENTS_DIR/.venv"
  fi

  log "Installing Python agent package"
  "$AGENTS_DIR/.venv/bin/python" -m pip install -e "$AGENTS_DIR"

  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    log "Installing frontend dependencies"
    (cd "$FRONTEND_DIR" && npm install)
  fi
}

validate_secret_env() {
  load_backend_env

  is_empty_env "${UNISWAP_API_KEY:-}" && die "Set UNISWAP_API_KEY in backend/.env"
  is_empty_env "${KEEPERHUB_API_KEY:-}" && die "Set KEEPERHUB_API_KEY in backend/.env"

  if [[ "$ENABLE_ZEROG" == "1" ]]; then
    is_empty_env "${ZEROG_PRIVATE_KEY:-}" && die "Set ZEROG_PRIVATE_KEY in backend/.env, or run with --no-zerog"
    is_empty_env "${ZEROG_KV_STREAM_ID:-}" && die "Set ZEROG_KV_STREAM_ID in backend/.env, or run with --no-zerog"
    is_empty_env "${ZEROG_EVM_RPC:-}" && die "Set ZEROG_EVM_RPC in backend/.env, or run with --no-zerog"
    is_empty_env "${ZEROG_INDEXER_RPC:-}" && die "Set ZEROG_INDEXER_RPC in backend/.env, or run with --no-zerog"
    is_empty_env "${ZEROG_KV_RPC:-}" && die "Set ZEROG_KV_RPC in backend/.env, or run with --no-zerog"
  fi

  return 0
}

configure_live_env() {
  local wallet="$1"
  local backup="$BACKEND_ENV.live-demo.bak.$(date +%Y%m%d%H%M%S)"
  cp "$BACKEND_ENV" "$backup"
  log "Backed up backend/.env to ${backup#$ROOT_DIR/}"

  set_env_value "$BACKEND_ENV" PORT "$BACKEND_PORT"
  set_env_value "$BACKEND_ENV" HOST "0.0.0.0"
  set_env_value "$BACKEND_ENV" CORS_ORIGIN "*"
  set_env_value "$BACKEND_ENV" UNISWAP_CHAIN_ID "11155111"
  set_env_value "$BACKEND_ENV" UNISWAP_SWAP_MODE "live"
  set_env_value "$BACKEND_ENV" UNISWAP_PERMIT2_DISABLED "true"
  set_env_value "$BACKEND_ENV" UNISWAP_SWAPPER_ADDRESS "$wallet"
  set_env_value "$BACKEND_ENV" WALLET_PRIVATE_KEY ""
  set_env_value "$BACKEND_ENV" MIN_TRADE_USD "$DEMO_TRADE_USD"
  set_env_value "$BACKEND_ENV" MAX_TRADE_USD_ABSOLUTE "$DEMO_TRADE_USD"
  set_env_value "$BACKEND_ENV" DEFAULT_PER_AGENT_STARTING_CAPITAL_USD "1"
  set_env_value "$BACKEND_ENV" AGENTS_PYTHON_PATH "$AGENTS_DIR/.venv/bin/python"
  set_env_value "$BACKEND_ENV" AGENTS_PACKAGE_DIR "$AGENTS_DIR"
  if [[ "$ENABLE_ZEROG" == "1" ]]; then
    set_env_value "$BACKEND_ENV" ZEROG_ENABLED "true"
  else
    set_env_value "$BACKEND_ENV" ZEROG_ENABLED "false"
  fi

  set_env_value "$FRONTEND_ENV" NEXT_PUBLIC_API_BASE_URL "http://localhost:$BACKEND_PORT"
}

ensure_allowance() {
  local wallet="$1"
  local state allowance eth usdc
  state="$(wallet_state "$wallet")"
  eth="$(printf '%s' "$state" | json_field eth)"
  usdc="$(printf '%s' "$state" | json_field usdc)"
  allowance="$(printf '%s' "$state" | json_field allowance)"

  log "KeeperHub wallet: $wallet"
  log "Sepolia balances: ETH=$eth USDC=$usdc allowance=$allowance"

  node -e "process.exit(Number('$eth') >= 0.005 ? 0 : 1)" || die "KeeperHub wallet needs Sepolia ETH for gas"
  node -e "process.exit(Number('$usdc') >= Number(process.env.DEMO_TRADE_USD || '0.1') ? 0 : 1)" || die "KeeperHub wallet needs Sepolia USDC"

  if node -e "process.exit(Number('$allowance') >= Number(process.env.DEMO_TRADE_USD || '0.1') ? 0 : 1)"; then
    log "USDC allowance is enough for the canary trade"
    return
  fi

  log "USDC allowance is below $DEMO_TRADE_USD"
  if [[ "$AUTO_APPROVE" == "ask" ]]; then
    if [[ -t 0 ]]; then
      read -r -p "Submit a KeeperHub approval for ${DEMO_ALLOWANCE_USDC} Sepolia USDC? [y/N] " answer
      case "$answer" in
        y|Y|yes|YES) AUTO_APPROVE=1 ;;
        *) AUTO_APPROVE=0 ;;
      esac
    else
      AUTO_APPROVE=0
    fi
  fi

  if [[ "$AUTO_APPROVE" != "1" ]]; then
    die "Allowance is low. Re-run with --approve or approve USDC manually."
  fi

  log "Submitting KeeperHub approval for ${DEMO_ALLOWANCE_USDC} Sepolia USDC"
  submit_keeperhub_approval >/tmp/agentslam-keeperhub-approval.json
  log "Approval submitted. Waiting for allowance to update"

  for ((i = 1; i <= 36; i += 1)); do
    sleep 5
    state="$(wallet_state "$wallet")"
    allowance="$(printf '%s' "$state" | json_field allowance)"
    log "Allowance check $i: $allowance USDC"
    if node -e "process.exit(Number('$allowance') >= Number(process.env.DEMO_TRADE_USD || '0.1') ? 0 : 1)"; then
      return
    fi
  done

  die "Approval did not appear on-chain in time. Check KeeperHub dashboard and rerun."
}

start_stack() {
  mkdir -p "$RUN_DIR"

  log "Starting PostgreSQL"
  (cd "$BACKEND_DIR" && docker compose up -d)

  stop_port "$BACKEND_PORT"
  stop_port "$FRONTEND_PORT"

  log "Starting backend on http://localhost:$BACKEND_PORT"
  start_detached "$BACKEND_DIR" "$RUN_DIR/backend.log" "$RUN_DIR/backend.pid" npm run dev
  wait_for_http "http://localhost:$BACKEND_PORT/health" "Backend" 90 || {
    tail -n 120 "$RUN_DIR/backend.log" >&2 || true
    die "Backend did not become ready"
  }
  record_port_pid "$BACKEND_PORT" "$RUN_DIR/backend.pid"

  log "Starting frontend on http://localhost:$FRONTEND_PORT"
  start_detached "$FRONTEND_DIR" "$RUN_DIR/frontend.log" "$RUN_DIR/frontend.pid" npm run dev -- --port "$FRONTEND_PORT"
  wait_for_http "http://localhost:$FRONTEND_PORT/matches" "Frontend" 90 || {
    tail -n 120 "$RUN_DIR/frontend.log" >&2 || true
    die "Frontend did not become ready"
  }
  record_port_pid "$FRONTEND_PORT" "$RUN_DIR/frontend.pid"
}

main() {
  need_cmd node
  need_cmd npm
  need_cmd python3
  need_cmd docker
  need_cmd curl

  ensure_env_files
  install_deps
  validate_secret_env
  load_backend_env

  log "Reading KeeperHub wallet"
  local wallet
  wallet="$(keeperhub_wallet)"

  configure_live_env "$wallet"
  load_backend_env

  export SEPOLIA_RPC_URL USDC_SEPOLIA WETH_SEPOLIA UNISWAP_SEPOLIA_PROXY_SPENDER DEMO_TRADE_USD DEMO_ALLOWANCE_USDC
  ensure_allowance "$wallet"

  log "Checking Uniswap Sepolia quote for ${DEMO_TRADE_USD} USDC"
  check_uniswap_quote "$wallet" >/tmp/agentslam-uniswap-quote.json
  log "Uniswap quote OK"

  start_stack

  cat <<EOF

Agent Slam live demo is running.

Frontend:
  http://localhost:$FRONTEND_PORT

Backend:
  http://localhost:$BACKEND_PORT

How to test from the UI:
  1. Open http://localhost:$FRONTEND_PORT
  2. Go to Strategies, click Run Simulation, or open Matches directly.
  3. In "Start Hackathon Match", use:
       Agent A strategy: DCA Bot
       Agent B strategy: Momentum Trader or Random Walk
       Pair: WETH/USDC
       Capital: 1
       Seconds: 30
  4. Click Start and watch the arena.

Live safety settings applied:
  UNISWAP_CHAIN_ID=11155111
  UNISWAP_SWAP_MODE=live
  UNISWAP_PERMIT2_DISABLED=true
  UNISWAP_SWAPPER_ADDRESS=$wallet
  MAX_TRADE_USD_ABSOLUTE=$DEMO_TRADE_USD
  ZEROG_ENABLED=$(if [[ "$ENABLE_ZEROG" == "1" ]]; then echo true; else echo false; fi)

Logs:
  $RUN_DIR/backend.log
  $RUN_DIR/frontend.log

Stop everything:
  ./scripts/stop-live-demo.sh
EOF
}

main "$@"
