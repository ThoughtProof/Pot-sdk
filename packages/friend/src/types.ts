export interface FriendMemory {
  sessionId: string;
  claimHash: string;
  claim: string;
  verdict: string;
  objections: string[]; // past objections this critic raised
  confidence: number;
  timestamp: number;
  domain?: string;
}

export interface FriendCriticOptions {
  sessionId: string;         // identifies the "relationship" — same session = same critic
  memoryPath?: string;       // path to SQLite DB (default: .pot-friend.db)
  eyebrowMode?: boolean;     // "...really?" skepticism based on context
  eyebrowThreshold?: number; // confidence delta that triggers eyebrow (default: 0.15)
  maxMemoryEntries?: number; // cap memory (default: 100)
}

export interface FriendCriticResult {
  critique: string;
  isEyebrow: boolean;          // true if this was a low-key "...really?" rather than full critique
  eyebrowReason?: string;      // what triggered the raised eyebrow
  recurringPatterns: string[]; // patterns this claim shares with past wrong claims
  memoryUsed: number;          // how many past entries influenced this critique
}
