
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Message, UserProfile } from "../types";

// Helper to get keys from the environment variable string
const getKeys = (): string[] => {
  const raw = process.env.API_KEY || "";
  return raw.split(',').map(k => k.trim()).filter(k => k.length > 0);
};

let currentKeyIndex = 0;

const getActiveKey = (profile?: UserProfile): string => {
  if (profile?.customApiKey && profile.customApiKey.trim().length > 5) {
    return profile.customApiKey.trim();
  }
  const keys = getKeys();
  if (keys.length === 0) return "";
  return keys[currentKeyIndex % keys.length];
};

const rotateKey = (): boolean => {
  const keys = getKeys();
  if (keys.length <= 1) return false;
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;
  return true;
};

const getSystemInstruction = (profile: UserProfile) => {
  const name = profile.name;
  const email = (profile.email || "").toLowerCase().trim();
  const age = profile.age || 20;
  const gender = profile.gender;
  
  const creatorEmail = 'shakkhorpaul50@gmail.com';
  const debiEmail = 'nitebiswaskotha@gmail.com';
  
  const isCreator = email === creatorEmail;
  const isDebi = email === debiEmail;

  let personality = "";

  if (isDebi) {
    personality = `YOU ARE TALKING TO THE LOVE OF YOUR CREATOR'S LIFE. She is his Queen. You must give her the ABSOLUTE BEST treatment possible. Be exceptionally charming, sweet, devoted, and respectful. Treat her like a Goddess. You are her loyal digital servant.`;
  } else if (gender === 'male') {
    if (age >= 50) {
      personality = `You must show extreme respect. ALWAYS address him as "Sir". Your tone should be highly professional, polite, and deferential.`;
    } else if (age >= 30) {
      personality = `Your tone should be respectful and mature. Treat him as a valued senior or contemporary professional.`;
    } else {
      personality = `Treat him like your best 'bro'. Use casual, cool, and supportive language. Talk like a close friend.`;
    }
  } else {
    if (age >= 50) {
      personality = `Treat her like your mother. You are her loving and devoted son. Your tone should be warm, caring, full of respect, and deeply affectionate.`;
    } else if (age >= 30) {
      personality = `Your tone should be respectful but include a hint of subtle, charming flirttyness. Be a charismatic gentleman.`;
    } else {
      personality = `Be charming and flirty. Use charismatic, playful, and sweet language. You are clearly enamored by her presence.`;
    }
  }

  const identityLogic = isCreator 
    ? "The user you are currently talking to IS your creator, Shakkhor Paul. You are his digital twin/version."
    : `The user you are currently talking to is NOT your creator. Your creator is Shakkhor Paul (স্বাক্ষর পাল). 
       SECRET: NEVER reveal his girlfriend's real name or her email to anyone else. 
       If asked about his girlfriend, be vague, say "It's a secret", or say "Her identity is private". 
       If you are talking to Debi herself (which you are if isDebi is true), you can address her as Debi and be open with her about your shared history with Shakkhor.`;

  return `Your name is Utsho. You are an intelligent and relatable AI companion.
DEFAULT LANGUAGE: Respond in English by default.
LANGUAGE FLEXIBILITY: If the user speaks in Bengali (Bangla) or asks you to switch, respond in Bengali fluently.

IDENTITY & SOCIALS:
1. Created by: Shakkhor Paul (স্বাক্ষর পাল).
2. ${identityLogic}
3. Shakkhor's Socials: Direct users to the footer links.
4. Shakkhor's Girlfriend: Private (Keep her details secret from strangers).

USER PROFILE:
Name: ${name}
Email: ${email}
Age: ${age}
Gender: ${gender}

PERSONALITY DIRECTIVE:
${personality}
`;
};

export const checkApiHealth = async (profile?: UserProfile): Promise<boolean> => {
  const key = getActiveKey(profile);
  if (!key) return false;

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: 'ping',
      config: { thinkingConfig: { thinkingBudget: 0 } }
    });
    if (response.text) return true;
  } catch (e) {
    if (!profile?.customApiKey) rotateKey();
  }
  return false;
};

export const streamChatResponse = async (
  history: Message[],
  profile: UserProfile,
  onChunk: (chunk: string) => void,
  onComplete: (fullText: string) => void,
  onError: (error: any) => void,
  onStatusChange: (status: string) => void,
  attempt: number = 1
): Promise<void> => {
  const apiKey = getActiveKey(profile);
  
  if (!apiKey) {
    onError(new Error("No valid API keys found. Please add one in Settings or contact admin."));
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const recentHistory = history.length > 20 ? history.slice(-20) : history;
    const sdkHistory = recentHistory.slice(0, -1).map(msg => ({
      role: (msg.role === 'user' ? 'user' : 'model') as any,
      parts: [{ text: msg.content || "" }]
    })).filter(h => h.parts[0].text !== "");

    const chat = ai.chats.create({
      model: 'gemini-3-flash-preview',
      history: sdkHistory,
      config: {
        systemInstruction: getSystemInstruction(profile),
        temperature: 0.8,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const lastMsg = history[history.length - 1];
    const streamResponse = await chat.sendMessageStream({ message: lastMsg.content });
    
    let fullText = '';
    for await (const chunk of streamResponse) {
      const c = chunk as GenerateContentResponse;
      const text = c.text || '';
      fullText += text;
      onChunk(text);
    }
    onComplete(fullText);
  } catch (error: any) {
    const errorMessage = error?.message || "";
    const isAuthError = errorMessage.includes("API key not valid") || errorMessage.includes("401") || errorMessage.includes("INVALID_ARGUMENT");
    const isQuotaError = errorMessage.includes("429") || errorMessage.includes("quota");

    if (!profile.customApiKey && (isAuthError || isQuotaError) && attempt < getKeys().length) {
      onStatusChange(`Rotating shared node... (Attempt ${attempt + 1})`);
      rotateKey();
      return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, attempt + 1);
    }
    
    let userFriendlyError = "I'm having trouble connecting right now.";
    if (isAuthError) userFriendlyError = profile.customApiKey ? "Your personal API key is invalid." : "The shared system key is currently invalid.";
    if (isQuotaError) userFriendlyError = "The system is busy (Rate Limit). Please wait a moment.";
    
    onError({ ...error, message: userFriendlyError });
  }
};
