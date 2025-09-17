export interface ZerionWalletPositionsResponse {
  links: {
    self: string;
  };
  data: Position[];
}

export interface Position {
  type: 'positions';
  id: string;
  attributes: PositionAttributes;
  relationships: PositionRelationships;
}

export interface PositionAttributes {
  parent: string | null;
  protocol: string;
  protocol_module: string;
  pool_address: string;
  group_id: string;
  name: string;
  position_type: 'staked' | 'reward' | 'deposit';
  quantity: Quantity;
  value: number | null;
  price: number;
  changes: Changes | null;
  fungible_info: FungibleInfo;
  flags: Flags;
  updated_at: string; // ISO 8601 date string
  updated_at_block: number | null;
  application_metadata: ApplicationMetadata;
}

export interface Quantity {
  int: string;
  decimals: number;
  float: number;
  numeric: string;
}

export interface Changes {
  absolute_1d: number;
  percent_1d: number;
}

export interface FungibleInfo {
  name: string;
  symbol: string;
  icon: Icon | null;
  flags: FungibleFlags;
  implementations: Implementation[];
}

export interface Icon {
  url: string;
}

export interface FungibleFlags {
  verified: boolean;
}

export interface Implementation {
  chain_id: string;
  address: string | null; // null for native tokens like BNB
  decimals: number;
}

export interface Flags {
  displayable: boolean;
  is_trash: boolean;
}

export interface ApplicationMetadata {
  name: string;
  icon: Icon | Record<string, never>; // Can be empty object {}
  url: string;
}

export interface PositionRelationships {
  chain: RelationshipLink;
  dapp: RelationshipData;
  fungible: RelationshipLink;
}

export interface RelationshipLink {
  links: {
    related: string;
  };
  data: RelationshipData;
}

export interface RelationshipData {
  type: string;
  id: string;
}

// Utility types for specific use cases
export type PositionType = PositionAttributes['position_type'];
export type ChainId = Implementation['chain_id'];

// Type guards for better type safety
export function isStakedPosition(position: Position): boolean {
  return position.attributes.position_type === 'staked';
}

export function isRewardPosition(position: Position): boolean {
  return position.attributes.position_type === 'reward';
}

export function isDepositPosition(position: Position): boolean {
  return position.attributes.position_type === 'deposit';
}

export function hasValue(position: Position): boolean {
  return position.attributes.value !== null && position.attributes.value > 0;
}

export function isVerifiedToken(position: Position): boolean {
  return position.attributes.fungible_info.flags.verified;
}

// Helper functions for working with the data
export function getTotalValue(positions: Position[]): number {
  return positions
    .filter(hasValue)
    .reduce((total, position) => total + (position.attributes.value || 0), 0);
}

export function getPositionsByProtocol(positions: Position[]): Record<string, Position[]> {
  return positions.reduce(
    (acc, position) => {
      const protocol = position.attributes.protocol;
      if (!acc[protocol]) {
        acc[protocol] = [];
      }
      acc[protocol].push(position);
      return acc;
    },
    {} as Record<string, Position[]>
  );
}

export function getPositionsByType(positions: Position[]): Record<PositionType, Position[]> {
  return positions.reduce(
    (acc, position) => {
      const type = position.attributes.position_type;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(position);
      return acc;
    },
    {} as Record<PositionType, Position[]>
  );
}
