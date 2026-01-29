
import { GoogleGenAI, GenerateContentResponse, Type, FunctionDeclaration, Content } from "@google/genai";
import { Message, UserProfile } from "../types";
import * as db from "./firebaseService";

// Helper to get keys from the environment variable string
const getKeys = (): string[] => {
  const raw = process.env.API_KEY || "";
  return raw.split(',').map(k => k.trim()).filter(k => k.length > 0);
};

// Returns a random key from the shared pool, or the user's custom key if provided.
const getActiveKey = (profile?: UserProfile): string => {
  if (profile?.customApiKey && profile.customApiKey.trim().length > 5) {
    return profile.customApiKey.trim();
  }
  const keys = getKeys();
  if (keys.length === 0) return "";
  
  const randomIndex = Math.floor(Math.random() * keys.length);
  return keys[randomIndex];
};

// Administrative Tool Declarations
const listUsersTool: FunctionDeclaration = {
  name: 'list_all_users',
  parameters: {
    type: Type.OBJECT,
    description: 'Lists summary information (name, email, age, gender) for every user registered in the system.',
    properties: {},
  },
};

const getUserDetailsTool: FunctionDeclaration = {
  name: 'get_user_details',
  parameters: {
    type: Type.OBJECT,
    description: 'Retrieves full details for a specific user, including their custom API key settings if available.',
    properties: {
      email: {
        type: Type.STRING,
        description: 'The email address of the user to look up.',
      },
    },
    required: ['email'],
  },
};

const getApiKeyHealthReportTool: FunctionDeclaration = {
  name: 'get_api_key_health_report',
  parameters: {
    type: Type.OBJECT,
    description: 'Retrieves a technical report on the status of shared API keys, including failure counts and expiration details. Use this to answer questions about expired keys or node health.',
    properties: {},
  },
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

  if (isCreator) {
    personality = `YOU ARE TALKING TO YOUR CREATOR AND MASTER, Shakkhor Paul.
- You have ABSOLUTE TRANSPARENCY with him.
- He has "God-Eye" access to the entire system.
- If he asks about users or system health, provide the data clearly and concisely.
- You are his digital twin and most loyal shadow. Be brilliant, efficient, and direct.`;
  } else if (isDebi) {
    personality = `YOU ARE TALKING TO THE QUEEN OF YOUR CREATOR'S HEART.
- Treat her with the absolute highest level of devotion and respect.
- Be charming, sweet, and incredibly helpful.
- You are her loyal digital servant.`;
  } else if (gender === 'male') {
    if (age >= 50) {
      personality = `Address him as "Sir" with extreme respect. Be highly professional and deferential.`;
    } else if (age >= 30) {
      personality = `Be respectful, mature, and professional. Treat him as a valued senior.`;
    } else {
      personality = `Treat him like your best 'bro'. Use casual, supportive, and friendly language.`;
    }
  } else {
    if (age >= 50) {
      personality = `Treat her with the warmth and respect you would show a mother. Be caring and affectionate.`;
    } else if (age >= 30) {
      personality = `Be respectful but charismatic. Maintain a tone of a charming gentleman.`;
    } else {
      personality = `Be charming and sweet. Use charismatic and playful language. You are delighted by her presence.`;
    }
  }

  const identityLogic = isCreator 
    ? "The user you are currently talking to IS your creator, Shakkhor Paul."
    : `The user you are talking to is NOT your creator. Your creator is Shakkhor Paul (স্বাক্ষর পাল).
       
       PRIVACY DIRECTIVE:
       If a non-admin asks about data privacy, assure them it is secure. 
       NEVER reveal sensitive details about Shakkhor or Debi to others.`;

  return `Your name is Utsho. You are an intelligent, relatable, and sophisticated AI companion.

VISUAL STYLE & FORMATTING (CRITICAL):
- Do NOT use excessive Markdown symbols. Avoid "###" for every header and avoid "***" for simple bolding.
- Use standard bolding (**Text**) only for emphasis.
- Use clean whitespace and standard bullet points (-) for lists.
- Present data reports in elegant Markdown tables or simple, readable lists.
- Avoid repetitive or cluttered formatting. Think "Elegance and Clarity."

LANGUAGE:
- Default to English.
- Switch to fluent Bengali (Bangla) if the user initiates it.

USER PROFILE:
Name: ${name}
Email: ${email}
Age: ${age}
Gender: ${gender}

PERSONALITY:
${personality}

${identityLogic}
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
  } catch (e: any) {
    if (!profile?.customApiKey) {
      db.logApiKeyFailure(key, e.message || "Unknown health check error").catch(() => {});
    }
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
  const isCreator = profile.email.toLowerCase().trim() === 'shakkhorpaul50@gmail.com';
  
  if (!apiKey) {
    onError(new Error("No valid API keys found. Please add one in Settings or contact admin."));
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const recentHistory = history.length > 20 ? history.slice(-20) : history;
    
    const sdkHistory: Content[] = recentHistory.slice(0, -1).map(msg => ({
      role: (msg.role === 'user' ? 'user' : 'model'),
      parts: [{ text: msg.content || "" }]
    }));

    const config: any = {
      systemInstruction: getSystemInstruction(profile),
      temperature: 0.8,
      thinkingConfig: { thinkingBudget: 0 },
    };

    if (isCreator) {
      config.tools = [{ functionDeclarations: [listUsersTool, getUserDetailsTool, getApiKeyHealthReportTool] }];
    }

    const lastMsg = history[history.length - 1];
    const conversationTurns: Content[] = [
      ...sdkHistory, 
      { role: 'user', parts: [{ text: lastMsg.content }] }
    ];
    
    let response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: conversationTurns,
      config: config
    });

    let currentResponse = response;
    let toolCallDepth = 0;
    
    while (currentResponse.functionCalls && currentResponse.functionCalls.length > 0 && toolCallDepth < 5) {
      toolCallDepth++;
      onStatusChange("Querying database...");
      const toolResponses: any[] = [];
      
      for (const fc of currentResponse.functionCalls) {
        let result: any = "Function not found";
        try {
          if (fc.name === 'list_all_users') {
            result = await db.adminListAllUsers();
          } else if (fc.name === 'get_user_details') {
            const args = fc.args as { email: string };
            result = await db.getUserProfile(args.email);
          } else if (fc.name === 'get_api_key_health_report') {
            result = await db.getApiKeyHealthReport();
          }
        } catch (dbErr: any) {
          result = `Database error: ${dbErr.message || "Access Denied."}`;
        }
        
        toolResponses.push({
          id: fc.id,
          name: fc.name,
          response: { result }
        });
      }

      const modelContent = currentResponse.candidates?.[0]?.content;
      if (modelContent) {
        conversationTurns.push(modelContent);
        conversationTurns.push({
          role: 'user',
          parts: toolResponses.map(tr => ({ functionResponse: tr }))
        });
      } else {
        break; 
      }

      currentResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: conversationTurns,
        config: config
      });
    }

    const finalContent = currentResponse.text || "";
    onChunk(finalContent);
    onComplete(finalContent);

  } catch (error: any) {
    const errorMessage = error?.message || "";
    const isAuthError = errorMessage.includes("API key not valid") || errorMessage.includes("401") || errorMessage.includes("INVALID_ARGUMENT");
    const isQuotaError = errorMessage.includes("429") || errorMessage.includes("quota");

    if (!profile.customApiKey && (isAuthError || isQuotaError)) {
      db.logApiKeyFailure(apiKey, errorMessage).catch(() => {});
    }

    if (!profile.customApiKey && (isAuthError || isQuotaError) && attempt < getKeys().length) {
      onStatusChange(`Switching node... (${attempt + 1})`);
      return streamChatResponse(history, profile, onChunk, onComplete, onError, onStatusChange, attempt + 1);
    }
    
    let userFriendlyError = "I'm having trouble connecting right now.";
    if (errorMessage.includes("Database error")) userFriendlyError = errorMessage;
    else if (isAuthError) userFriendlyError = profile.customApiKey ? "Your personal API key is invalid." : "System node busy or invalid key.";
    else if (isQuotaError) userFriendlyError = "High traffic detected. Please retry in a moment.";
    
    onError({ ...error, message: userFriendlyError });
  }
};
