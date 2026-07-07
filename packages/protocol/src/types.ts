export type EvmAddress = `0x${string}`;
export type HexString = `0x${string}`;

export type AbiParameter = {
  readonly name?: string;
  readonly internalType?: string;
  readonly type: string;
  readonly indexed?: boolean;
  readonly components?: readonly AbiParameter[];
};

export type AbiFunctionFragment = {
  readonly type: "function";
  readonly name: string;
  readonly inputs: readonly AbiParameter[];
  readonly outputs: readonly AbiParameter[];
  readonly stateMutability: "pure" | "view" | "nonpayable" | "payable";
};

export type AbiEventFragment = {
  readonly type: "event";
  readonly name: string;
  readonly anonymous: boolean;
  readonly inputs: readonly AbiParameter[];
};

export type AbiConstructorFragment = {
  readonly type: "constructor";
  readonly inputs: readonly AbiParameter[];
  readonly stateMutability: "nonpayable" | "payable";
};

export type AbiReceiveFragment = {
  readonly type: "receive";
  readonly stateMutability: "payable";
};

export type AbiErrorFragment = {
  readonly type: "error";
  readonly name: string;
  readonly inputs: readonly AbiParameter[];
};

export type AbiFragment =
  | AbiFunctionFragment
  | AbiEventFragment
  | AbiConstructorFragment
  | AbiReceiveFragment
  | AbiErrorFragment;
export type Abi = readonly AbiFragment[];
