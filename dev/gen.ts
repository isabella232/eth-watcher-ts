import {
    parse,
    introspectionQuery,
    buildClientSchema,
    printSchema,
    buildASTSchema,
    visit,
    print, TypeNode, FieldDefinitionNode
} from 'graphql';
import {NamedTypeNode, TypeDefinitionNode} from "graphql/language/ast";
import {TableOptions} from "typeorm/schema-builder/options/TableOptions";
import {TableColumnOptions} from "typeorm/schema-builder/options/TableColumnOptions";
const kebabCase = require('lodash.kebabcase');

const TYPES = {
    'String': 'text',
    'ID': 'integer',
    'Int': 'integer',
    'Float': 'numeric',
    'Boolean': 'boolean',
    'Bytes': 'bytea',
    'JSON': 'jsonb',
}

const sdlSchema1 = `
type UniswapFactory @entity {
  # factory address
  id: ID!

  # pair info
  pairCount: Int!

  # total volume
  totalVolumeUSD: BigDecimal!
  totalVolumeETH: BigDecimal!

  # untracked values - less confident USD scores
  untrackedVolumeUSD: BigDecimal!

  # total liquidity
  totalLiquidityUSD: BigDecimal!
  totalLiquidityETH: BigDecimal!

  # transactions
  txCount: BigInt!
}

type Token @entity {
  # token address
  id: ID!

  # mirrored from the smart contract
  symbol: String!
  name: String!
  decimals: BigInt!

  # used for other stats like marketcap
  totalSupply: BigInt!

  # token specific volume
  tradeVolume: BigDecimal!
  tradeVolumeUSD: BigDecimal!
  untrackedVolumeUSD: BigDecimal!

  # transactions across all pairs
  txCount: BigInt!

  # liquidity across all pairs
  totalLiquidity: BigDecimal!

  # derived prices
  derivedETH: BigDecimal

  # derived fields
  tokenDayData: [TokenDayData!]! @derivedFrom(field: "token")
  pairDayDataBase: [PairDayData!]! @derivedFrom(field: "token0")
  pairDayDataQuote: [PairDayData!]! @derivedFrom(field: "token1")
  pairBase: [Pair!]! @derivedFrom(field: "token0")
  pairQuote: [Pair!]! @derivedFrom(field: "token1")
}

type Pair @entity {
  # pair address
  id: ID!

  # mirrored from the smart contract
  token0: Token!
  token1: Token!
  reserve0: BigDecimal!
  reserve1: BigDecimal!
  totalSupply: BigDecimal!

  # derived liquidity
  reserveETH: BigDecimal!
  reserveUSD: BigDecimal!
  trackedReserveETH: BigDecimal! # used for separating per pair reserves and global
  # Price in terms of the asset pair
  token0Price: BigDecimal!
  token1Price: BigDecimal!

  # lifetime volume stats
  volumeToken0: BigDecimal!
  volumeToken1: BigDecimal!
  volumeUSD: BigDecimal!
  untrackedVolumeUSD: BigDecimal!
  txCount: BigInt!

  # creation stats
  createdAtTimestamp: BigInt!
  createdAtBlockNumber: BigInt!

  # Fields used to help derived relationship
  liquidityProviderCount: BigInt! # used to detect new exchanges
  # derived fields
  pairHourData: [PairHourData!]! @derivedFrom(field: "pair")
  liquidityPositions: [LiquidityPosition!]! @derivedFrom(field: "pair")
  liquidityPositionSnapshots: [LiquidityPositionSnapshot!]! @derivedFrom(field: "pair")
  mints: [Mint!]! @derivedFrom(field: "pair")
  burns: [Burn!]! @derivedFrom(field: "pair")
  swaps: [Swap!]! @derivedFrom(field: "pair")
}

type User @entity {
  id: ID!
  liquidityPositions: [LiquidityPosition!] @derivedFrom(field: "user")
  usdSwapped: BigDecimal!
}

type LiquidityPosition @entity {
  id: ID!
  user: User!
  pair: Pair!
  liquidityTokenBalance: BigDecimal!
}

# saved over time for return calculations, gets created and never updated
type LiquidityPositionSnapshot @entity {
  id: ID!
  liquidityPosition: LiquidityPosition!
  timestamp: Int! # saved for fast historical lookups
  block: Int! # saved for fast historical lookups
  user: User! # reference to user
  pair: Pair! # reference to pair
  token0PriceUSD: BigDecimal! # snapshot of token0 price
  token1PriceUSD: BigDecimal! # snapshot of token1 price
  reserve0: BigDecimal! # snapshot of pair token0 reserves
  reserve1: BigDecimal! # snapshot of pair token1 reserves
  reserveUSD: BigDecimal! # snapshot of pair reserves in USD
  liquidityTokenTotalSupply: BigDecimal! # snapshot of pool token supply
  liquidityTokenBalance: BigDecimal! # snapshot of users pool token balance
}

type Transaction @entity {
  id: ID! # txn hash
  blockNumber: BigInt!
  timestamp: BigInt!
  # This is not the reverse of Mint.transaction; it is only used to
  # track incomplete mints (similar for burns and swaps)
  mints: [Mint]!
  burns: [Burn]!
  swaps: [Swap]!
}

type Mint @entity {
  # transaction hash + "-" + index in mints Transaction array
  id: ID!
  transaction: Transaction!
  timestamp: BigInt! # need this to pull recent txns for specific token or pair
  pair: Pair!

  # populated from the primary Transfer event
  to: Bytes!
  liquidity: BigDecimal!

  # populated from the Mint event
  sender: Bytes
  amount0: BigDecimal
  amount1: BigDecimal
  logIndex: BigInt
  # derived amount based on available prices of tokens
  amountUSD: BigDecimal

  # optional fee fields, if a Transfer event is fired in _mintFee
  feeTo: Bytes
  feeLiquidity: BigDecimal
}

type Burn @entity {
  # transaction hash + "-" + index in mints Transaction array
  id: ID!
  transaction: Transaction!
  timestamp: BigInt! # need this to pull recent txns for specific token or pair
  pair: Pair!

  # populated from the primary Transfer event
  liquidity: BigDecimal!

  # populated from the Burn event
  sender: Bytes
  amount0: BigDecimal
  amount1: BigDecimal
  to: Bytes
  logIndex: BigInt
  # derived amount based on available prices of tokens
  amountUSD: BigDecimal

  # mark uncomplete in ETH case
  needsComplete: Boolean!

  # optional fee fields, if a Transfer event is fired in _mintFee
  feeTo: Bytes
  feeLiquidity: BigDecimal
}

type Swap @entity {
  # transaction hash + "-" + index in swaps Transaction array
  id: ID!
  transaction: Transaction!
  timestamp: BigInt! # need this to pull recent txns for specific token or pair
  pair: Pair!

  # populated from the Swap event
  sender: Bytes!
  from: Bytes! # the EOA that initiated the txn
  amount0In: BigDecimal!
  amount1In: BigDecimal!
  amount0Out: BigDecimal!
  amount1Out: BigDecimal!
  to: Bytes!
  logIndex: BigInt

  # derived info
  amountUSD: BigDecimal!
}

# stores for USD calculations
type Bundle @entity {
  id: ID!
  ethPrice: BigDecimal! # price of ETH usd
}

# Data accumulated and condensed into day stats for all of Uniswap
type UniswapDayData @entity {
  id: ID! # timestamp rounded to current day by dividing by 86400
  date: Int!

  dailyVolumeETH: BigDecimal!
  dailyVolumeUSD: BigDecimal!
  dailyVolumeUntracked: BigDecimal!

  totalVolumeETH: BigDecimal!
  totalLiquidityETH: BigDecimal!
  totalVolumeUSD: BigDecimal! # Accumulate at each trade, not just calculated off whatever totalVolume is. making it more accurate as it is a live conversion
  totalLiquidityUSD: BigDecimal!

  txCount: BigInt!
}

type PairHourData @entity {
  id: ID!
  hourStartUnix: Int! # unix timestamp for start of hour
  pair: Pair!

  # reserves
  reserve0: BigDecimal!
  reserve1: BigDecimal!

  # derived liquidity
  reserveUSD: BigDecimal!

  # volume stats
  hourlyVolumeToken0: BigDecimal!
  hourlyVolumeToken1: BigDecimal!
  hourlyVolumeUSD: BigDecimal!
  hourlyTxns: BigInt!
}

# Data accumulated and condensed into day stats for each exchange
type PairDayData @entity {
  id: ID!
  date: Int!
  pairAddress: Bytes!
  token0: Token!
  token1: Token!

  # reserves
  reserve0: BigDecimal!
  reserve1: BigDecimal!

  # total supply for LP historical returns
  totalSupply: BigDecimal!

  # derived liquidity
  reserveUSD: BigDecimal!

  # volume stats
  dailyVolumeToken0: BigDecimal!
  dailyVolumeToken1: BigDecimal!
  dailyVolumeUSD: BigDecimal!
  dailyTxns: BigInt!
}

type TokenDayData @entity {
  id: ID!
  date: Int!
  token: Token!

  # volume stats
  dailyVolumeToken: BigDecimal!
  dailyVolumeETH: BigDecimal!
  dailyVolumeUSD: BigDecimal!
  dailyTxns: BigInt!

  # liquidity stats
  totalLiquidityToken: BigDecimal!
  totalLiquidityETH: BigDecimal!
  totalLiquidityUSD: BigDecimal!

  # price stats
  priceUSD: BigDecimal!
}
`;

const sdlSchema2 = `
    type Book {
      title: String!
      author: Person!
      rating: Float
    }
    type Person {
      name: String!
      age: Int
    }
`;

const res = parse(sdlSchema2);

function parseFieldDefinition(node: FieldDefinitionNode | TypeNode): TableColumnOptions {
    switch (node.kind) {
        case "FieldDefinition":
            return Object.assign(parseFieldDefinition(node.type), {
                name: node.name.value
            });
            break;
        case "NonNullType":
            return Object.assign(parseFieldDefinition(node.type), {
                isNullable: false
            });
        case "NamedType":
            const type = TYPES[node.name.value];
            if (type) {
                // basic type like int,string,bytes
                return {
                    name: null,
                    type,
                };
            }

            return {
                name: null,
                type: TYPES['Int'],
                comment: node.name.value, // table name for foreign key
            }
        case "ListType":
            return Object.assign(parseFieldDefinition(node.type), {
                isArray: true
            })
        default:
            throw Error('Unsupported type');
    }
}

res.definitions.forEach(ast => {
    const tableName = kebabCase((ast as TypeDefinitionNode).name.value);

    const tableOptions: TableOptions = {
        name: tableName,
        columns: [
            {
                name: 'id',
                type: 'integer',
                isPrimary: true,
                isGenerated: true,
                generationStrategy: 'increment'
            },
        ],
    };

    visit(ast, {
        FieldDefinition(node) {
            const columnOptions: TableColumnOptions = parseFieldDefinition(node);
            tableOptions.columns.push(columnOptions);
        }
    });

    const foreignKeys = tableOptions.columns
        .filter((column) => column.comment)
        .map((column) => ({
            name: `fk-${column.name}-${kebabCase(column.comment)}-id`,
            referencedTableName: kebabCase(column.comment),
            referencedColumnNames: ['id'],
            columnNames: [column.name],
        }));

    if (foreignKeys) {
        tableOptions.foreignKeys = foreignKeys;
    }

    console.log('tableOptions', tableOptions);
});
