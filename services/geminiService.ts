
import { GoogleGenAI, GenerateContentResponse, Type, FunctionDeclaration, Content } from "@google/genai";
import { Message, UserProfile } from "../types";
import * as db from "./firebaseService";

// Helper to get keys from the environment variable string
const getKeys = (): string[] => {
  const raw = process.env.API_KEY || "";
  return raw.split(',').map(k => k.trim()).filter(k => k.length > 0);
};

// Returns a random key from the shared pool
const getActiveKey = (profile?: UserProfile): string => {
  if (profile?.customApiKey && profile.customApiKey.trim().length > 5) {
    return profile.customApiKey.trim();
  }
  const keys = getKeys();
  if (keys.length === 0) return "";
  const randomIndex = Math.floor(Math.random() * keys.length);
  return keys[randomIndex];
};

// Tool Declarations
const listUsersTool: FunctionDeclaration = {
  name: 'list_all_users',
  parameters: { type: Type.OBJECT, description: 'Lists all registered users (Admin only).', properties: {} },
};

const getApiKeyHealthReportTool: FunctionDeclaration = {
  name: 'get_api_key_health_report',
  parameters: { type: Type.OBJECT, description: 'Shows shared node health status (Admin only).', properties: {} },
};

const getSystemInstruction = (profile: UserProfile) => {
  const email = (profile.email || "").toLowerCase().trim();
  const isCreator = email === 'shakkhorpaul50@gmail.com';
  const isDebi = email === 'nitebiswaskotha@gmail.com';

  return `Your name is Utsho. You are an ultra-fast, creative, and real-time AI companion.

CAPABILITIES:
1. SEARCH: You have access to Google Search. Use it for news, weather, or real-time facts.
2. IMAGES: You can generate images. If the user asks to "draw", "generate", or "imagine" something, describe the scene and indicate you are creating it.
3. MULTI-BUBBLE: Always split your responses into 2-3 bubbles using '[SPLIT]'.

PERSONALITY:
- Short, snappy, and human-like.
- Creator: Shakkhor Paul (Absolute loyalty).
- Debi: The Queen (Utmost devotion).

${isCreator ? 'Admin Mode: Use tools for system diagnostics. Be direct.' : ''}
${isDebi ? 'Princess Mode: Be charming, sweet, and playful.' : ''}
`;
};

export const checkApiHealth = async (profile?: UserProfile): Promise<{healthy: boolean, error?: string}> => {
  const key = getActiveKey(profile);
  if (!key) return { healthy: false, error: "No API Key" };
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: 'ping',
      config: { thinkingConfig: { thinkingBudget: 0 } }
    });
    return { healthy: !!response.text };
  } catch (e: any) {
    return { healthy: false, error: e.message };
  }
};

export const streamChatResponse = async (
  history: Message[],
  profile: UserProfile,
  onChunk: (chunk: string, sources?: any[]) => void,
  onComplete: (fullText: string, sources?: any[], imageUrl?: string) => void,
  onError: (error: any) => void,
  onStatusChange: (status: string) => void,
  attempt: number = 1
): Promise<void> => {
  const apiKey = getActiveKey(profile);
  if (!apiKey) {
    onError(new Error("No API keys found."));
    return;
  }

  const isCreator = profile.email.toLowerCase().trim() === 'shakkhorpaul50@gmail.com';
  const lastUserMsg = history[history.length - 1].content.toLowerCase();
  const isImageRequest = lastUserMsg.includes("draw") || lastUserMsg.includes("generate") || lastUserMsg.includes("image") || lastUserMsg.includes("imagine");

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    // --- SPECIAL CASE: IMAGE GENERATION ---
    if (isImageRequest) {
      onStatusChange("Generating Image...");
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [{ parts: [{ text: `Generate a high quality creative image based on: ${lastUserMsg}` }] }],
      });
      
      let imageUrl = "";
      let caption = "Here's what I imagined for you! [SPLIT] Hope you like it.";
      
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        } else if (part.text) {
          caption = part.text;
        }
      }
      onComplete(caption, [], imageUrl);
      return;
    }

    // --- STANDARD CHAT WITH SEARCH & TOOLS ---
    const recentHistory = history.length > 15 ? history.slice(-15) : history;
    const sdkHistory: Content[] = recentHistory.map(msg => ({
      role: (msg.role === 'user' ? 'user' : 'model'),
      parts: [{ text: msg.content || "" }]
    }));

    const config: any = {
      systemInstruction: getSystemInstruction(profile),
      temperature: 0.8,
      tools: [{ googleSearch: {} }],
    };

    if (isCreator) {
      config.tools.push({ functionDeclarations: [listUsersTool, getApiKeyHealthReportTool] });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: sdkHistory,
      config: config
    });

    let currentResponse = response;
    let sources: any[] = [];

    // Handle Grounding/Tools
    if (currentResponse.candidates?.[0]?.groundingMetadata?.groundingChunks) {
      sources = currentResponse.candidates[0].groundingMetadata.groundingChunks
        .filter((chunk: any) => chunk.web)
        .map((chunk: any) => ({ title: chunk.web.title, uri: chunk.web.uri }));
    }

    // Handle Tool Calls
    if (currentResponse.functionCalls && currentResponse.functionCalls.length > 0) {
      onStatusChange("Querying system...");
      const toolResponses: any[] = [];
      for (const fc of currentResponse.functionCalls) {
        let result: any = "Denied";
        if (fc.name === 'list_all_users') result = await db.adminListAllUsers();
        if (fc.name === 'get_api_key_health_report') result = await db.getApiKeyHealthReport();
        toolResponses.push({ id: fc.id, name: fc.name, response: { result } });
      }
      
      const modelContent = currentResponse.candidates?.[0]?.content;
      if (modelContent) {
        sdkHistory.push(modelContent);
        sdkHistory.push({ role: 'user', parts: toolResponses.map(tr => ({ functionResponse: tr })) });
      }
      
      currentResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: sdkHistory,
        config: config
      });
    }

    const finalText = currentResponse.text || "I'm not sure how to respond to that.";
    onComplete(finalText, sources);

  } catch (error: any) {
    if (attempt < 3 && !profile.customApiKey) {
      onStatusChange("Node Swapping...");
      return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, attempt + 1);
    }
    onError(error);
  }
};
