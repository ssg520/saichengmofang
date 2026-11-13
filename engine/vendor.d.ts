// 第三方无类型库的最小 ambient 声明（仅引擎用到的 API）
declare module 'roundrobin' {
  // 返回轮次 → 该轮的对阵 [away, home]；奇数队自动含轮空（DUMMY 已过滤）
  function robin(n: number, players?: (string | number)[]): [string, string][][];
  export = robin;
}

declare module 'swiss-pairing' {
  export interface SwissParticipant {
    id: string;
    seed: number;
  }
  export interface SwissMatchInput {
    round: number;
    home: { id: string; points: number };
    away: { id: string; points: number };
  }
  export interface SwissMatchup {
    home: string;
    away: string | null;
  }
  export interface SwissStanding {
    id: string;
    seed: number;
    wins: number;
    losses: number;
    tiebreaker: number;
  }
  export interface SwissOptions {
    maxPointsPerRound?: number;
    rematchWeight?: number;
    standingPower?: number;
    seedMultiplier?: number;
  }
  export interface SwissEngine {
    getMatchups(round: number, participants: SwissParticipant[], matches: SwissMatchInput[]): SwissMatchup[];
    getStandings(round: number, participants: SwissParticipant[], matches: SwissMatchInput[]): SwissStanding[];
  }
  function createSwiss(options?: SwissOptions): SwissEngine;
  export = createSwiss;
}