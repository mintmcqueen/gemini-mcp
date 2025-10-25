export interface GeminiMessage {
  role: "user" | "model";
  parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
}

export interface GeminiRequest {
  contents: GeminiMessage[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
  };
}

export interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
    index: number;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export interface FileUpload {
  name: string;
  mimeType: string;
  data: string; // base64 encoded
}

export interface ChatArgs {
  message: string;
  files?: FileUpload[];
  temperature?: number;
  maxTokens?: number;
}

export function isValidChatArgs(args: any): args is ChatArgs {
  return (
    typeof args === "object" &&
    args !== null &&
    "message" in args &&
    typeof args.message === "string" &&
    (args.files === undefined || Array.isArray(args.files)) &&
    (args.temperature === undefined || typeof args.temperature === "number") &&
    (args.maxTokens === undefined || typeof args.maxTokens === "number")
  );
}

export interface ConversationSession {
  id: string;
  messages: GeminiMessage[];
  createdAt: Date;
  lastActivity: Date;
}

export interface UploadedFile {
  name: string;
  displayName: string;
  mimeType: string;
  sizeBytes: string;
  createTime: string;
  updateTime: string;
  expirationTime: string;
  sha256Hash: string;
  uri: string;
  state: string;
}