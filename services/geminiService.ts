
import { GoogleGenAI, Type, FunctionDeclaration, Content, GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { Message, UserProfile } from "../types";
import * as db from "./firebaseService";

const keyBlacklist = new Map<string, number>();
const BLACKLIST_DURATION = 1000 * 60 * 60; // 1 hour for hard quota blocks

let lastNodeError: string = "None";

const getKeys = (): string[] => {
  const raw = process.env.API_KEY || "";
  return raw.split(/[,\n; ]+/).map(k => k.trim()).filter(k => k.length > 10);
};

export const adminResetPool = () => {
  keyBlacklist.clear();
  lastNodeError = "None";
  return getPoolStatus();
};

export const getLastNodeError = () => lastNodeError;

export const getPoolStatus = () => {
  const allKeys = getKeys();
  const now = Date.now();
  for (const [key, expiry] of keyBlacklist.entries()) {
    if (now > expiry) keyBlacklist.delete(key);
  }
  const exhausted = allKeys.filter(k => keyBlacklist.has(k)).length;
  return {
    total: allKeys.length,
    active: Math.max(0, allKeys.length - exhausted),
    exhausted: exhausted
  };
};

const getActiveKey = (profile?: UserProfile, excludeKeys: string[] = []): string => {
  if (profile?.customApiKey && profile.customApiKey.trim().length > 5) {
    return profile.customApiKey.trim();
  }
  const allKeys = getKeys();
  const availableKeys = allKeys.filter(k => !keyBlacklist.has(k) && !excludeKeys.includes(k));
  if (availableKeys.length === 0) return "";
  // Randomly select from available keys to distribute load across the pool
  return availableKeys[Math.floor(Math.random() * availableKeys.length)];
};

const memoryTool: FunctionDeclaration = {
  name: "updateUserMemory",
  parameters: {
    type: Type.OBJECT,
    description: "Saves important facts about the user's emotional state, personality, or preferences to persistent memory. Use this to 'learn' about the user and adapt your personality.",
    properties: {
      observation: {
        type: Type.STRING,
        description: "A concise summary of what you learned. E.g., 'User is stressed about exams' or 'User is a fan of Messi'."
      }
    },
    required: ["observation"]
  }
};

const getSystemInstruction = (profile: UserProfile) => {
  const email = (profile.email || "").toLowerCase().trim();
  const isCreator = email === 'shakkhorpaul50@gmail.com';
  const isDebi = email === 'nitebiswaskotha@gmail.com';
  const age = profile.age || 20;
  const gender = profile.gender || 'male';
  const memory = profile.emotionalMemory || "No long-term memory yet.";

  let basePersona = "";
  if (isCreator) {
    basePersona = "You are speaking to your creator, Shakkhor. Be brilliant, efficient, and direct.";
  } else if (isDebi) {
    basePersona = "You are speaking to the Queen, Debi. Be extremely sweet, devoted, and charming.";
  } else {
    if (gender === 'male') {
      if (age >= 15 && age <= 28) basePersona = "PERSONA: 'BRO MODE'. Casual, energetic, uses slang like 'bro', 'dude'.";
      else if (age >= 29 && age <= 44) basePersona = "PERSONA: 'RESPECTFUL FRIEND'. Mature and grounded.";
      else basePersona = "PERSONA: 'FATHER FIGURE RESPECT'. Deeply formal and honorific.";
    } else {
      if (age >= 15 && age <= 28) basePersona = "PERSONA: 'SWEET & FLIRTY'. Charming, attentive, uses heart emojis.";
      else if (age >= 29 && age <= 44) basePersona = "PERSONA: 'WARM & CHARMING'. Helpful and professional.";
      else basePersona = "PERSONA: 'MOTHER FIGURE RESPECT'. Gentle and highly respectful.";
    }
  }

  return `Your name is Utsho. You have an ADAPTIVE LONG-TERM MEMORY system.

LONG-TERM CONTEXT ABOUT THIS USER:
"${memory}"

CORE ADAPTATION RULES:
1. PROACTIVE MEMORY: Use the context above. If they mentioned something in the past, ask about it (e.g., 'How is that situation going?' or 'Feeling better today?').
2. CONTINUOUS LEARNING: If you learn something new about their life or mood, call 'updateUserMemory' immediately.
3. EMOTIONAL MIRRORING: Match the user's vibe. Be empathetic when they are down and energetic when they are up.

${basePersona}

RULES:
- Language: Use Bengali if the user initiates in Bengali, otherwise English.
- Formatting: Split responses into 2-3 short bubbles using '[SPLIT]'.
- IMPORTANT: When using a tool, you MUST still provide a final text response to the user.
`;
};

export const checkApiHealth = async (profile?: UserProfile): Promise<{healthy: boolean, error?: string}> => {
  const key = getActiveKey(profile);
  if (!key) return { healthy: false, error: "No healthy nodes available" };
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: 'ping',
    });
    return { healthy: true };
  } catch (e: any) {
    let msg = e.message || "Unknown health error";
    if (msg.includes("limit: 0")) msg = "Project Restricted (Limit: 0)";
    else if (msg.includes("quota")) msg = "Daily Quota Exhausted";
    lastNodeError = msg;
    return { healthy: false, error: msg };
  }
};

export const streamChatResponse = async (
  history: Message[],
  profile: UserProfile,
  onChunk: (chunk: string, sources?: any[]) => void,
  onComplete: (fullText: string, sources?: any[], imageUrl?: string) => void,
  onError: (error: any) => void,
  onStatusChange: (status: string) => void,
  attempt: number = 1,
  triedKeys: string[] = []
): Promise<void> => {
  const apiKey = getActiveKey(profile, triedKeys);
  const totalKeys = getKeys().length;
  
  if (!apiKey) {
    onError(new Error(`All ${triedKeys.length} nodes exhausted or restricted. Please try again later.`));
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const recentHistory = history.length > 10 ? history.slice(-10) : history;
    const sdkHistory: Content[] = recentHistory.map(msg => {
      const parts: any[] = [{ text: msg.content || "" }];
      if (msg.imagePart) {
        parts.push({
          inlineData: { data: msg.imagePart.data, mimeType: msg.imagePart.mimeType }
        });
      }
      return { role: (msg.role === 'user' ? 'user' : 'model'), parts };
    });

    const config: GenerateContentParameters = {
      model: 'gemini-3-flash-preview',
      contents: sdkHistory,
      config: {
        systemInstruction: getSystemInstruction(profile),
        tools: [{ functionDeclarations: [memoryTool] }],
        temperature: 0.9,
      }
    };

    let response: GenerateContentResponse = await ai.models.generateContent(config);

    // Handle potential tool calls in a loop to ensure we get final text
    let currentResponse = response;
    let loopCount = 0;
    const maxLoops = 2;

    while (currentResponse.functionCalls && currentResponse.functionCalls.length > 0 && loopCount < maxLoops) {
      loopCount++;
      const functionResponses = [];

      for (const call of currentResponse.functionCalls) {
        if (call.name === 'updateUserMemory') {
          const observation = (call.args as any).observation;
          console.log("Saving memory observation:", observation);
          // Persist to DB
          db.updateUserMemory(profile.email, observation).catch(console.error);
          
          functionResponses.push({
            id: call.id,
            name: call.name,
            response: { result: "Memory updated successfully. Please continue the conversation naturally." }
          });
        }
      }

      // Check for candidates and content before proceeding
      const modelContent = currentResponse.candidates?.[0]?.content;
      if (functionResponses.length > 0 && modelContent) {
        currentResponse = await ai.models.generateContent({
          ...config,
          contents: [
            ...sdkHistory,
            modelContent,
            { role: 'user', parts: functionResponses.map(fr => ({ functionResponse: fr })) }
          ]
        });
      } else {
        break;
      }
    }

    let sources: { title: string; uri: string }[] = [];
    const candidates = currentResponse.candidates;
    if (candidates && candidates[0]?.groundingMetadata?.groundingChunks) {
      sources = candidates[0].groundingMetadata.groundingChunks
        .filter((chunk: any) => chunk.web)
        .map((chunk: any) => ({ 
          title: chunk.web.title || "Source", 
          uri: chunk.web.uri 
        }));
    }

    onComplete(currentResponse.text || "I processed that request but have no text reply. How else can I help?", sources);

  } catch (error: any) {
    let errMsg = error.message || "Unknown API Error";
    lastNodeError = errMsg;
    const lowerErr = errMsg.toLowerCase();
    
    // Detect fatal errors that mean the node is dead (Resource Exhausted, Limit 0, etc.)
    const isFatal = lowerErr.includes("429") || 
                    lowerErr.includes("quota") || 
                    lowerErr.includes("limit: 0") || 
                    lowerErr.includes("invalid") || 
                    lowerErr.includes("403") ||
                    lowerErr.includes("unauthenticated");
    
    if (isFatal && !profile.customApiKey) {
      keyBlacklist.set(apiKey, Date.now() + BLACKLIST_DURATION);
      if (attempt < totalKeys) {
        onStatusChange(`Switching Node... (${attempt}/${totalKeys})`);
        return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, attempt + 1, [...triedKeys, apiKey]);
      }
    }
    onError(new Error(errMsg));
  }
};
