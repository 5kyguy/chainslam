import { Wallet } from "ethers";

export interface Permit2SignerConfig {
  privateKey: string;
}

export interface Eip712Domain {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract?: string;
  salt?: string;
}

export interface Permit2Data {
  domain: Eip712Domain;
  types: Record<string, Array<{ name: string; type: string }>>;
  values: Record<string, unknown>;
}

export class Permit2Signer {
  private wallet: Wallet;

  constructor(config: Permit2SignerConfig) {
    const key = config.privateKey.trim();
    this.wallet = new Wallet(key.startsWith("0x") ? key : `0x${key}`);
  }

  get address(): string {
    return this.wallet.address;
  }

  async signPermitData(permitData: unknown): Promise<string> {
    if (!permitData || typeof permitData !== "object") {
      throw new Error("permitData is missing or not an object");
    }

    const pd = permitData as Record<string, unknown>;
    const domain = pd.domain;
    const types = pd.types as Record<string, Array<{ name: string; type: string }>> | undefined;
    const values = pd.values ?? pd.message;

    if (!domain || !types || !values) {
      throw new Error(
        `permitData missing required fields. Has: domain=${!!domain}, types=${!!types}, values/message=${!!values}`,
      );
    }

    const sanitizedTypes = { ...types };
    delete (sanitizedTypes as Record<string, unknown>).EIP712Domain;

    const signature = await this.wallet.signTypedData(
      domain as Eip712Domain,
      sanitizedTypes,
      values as Record<string, unknown>,
    );

    return signature;
  }
}

export function isValidPrivateKey(key: string): boolean {
  const trimmed = key.trim();
  if (trimmed.length === 0) return false;
  try {
    const normalized = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
    new Wallet(normalized);
    return true;
  } catch {
    return false;
  }
}
