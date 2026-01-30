import { GoogleGenAI, Type, FunctionDeclaration, Content, GenerateContentResponse } from "@google/genai";
import { Message, UserProfile } from "../types";
import * as db from "./firebaseService";

// Helper to construct system instruction based on user profile
const getSystemInstruction = (profile: UserProfile) => {
  const email = (profile.email || "").toLowerCase().trim();
  const isCreator = email === db.ADMIN_EMAIL;
  const isDebi = email === 'nitebiswaskotha@gmail.com';
  const age = profile.age || 20;
  const gender = profile.gender || 'male';
  const memory = profile.emotionalMemory || "Fresh start.";

  let modeName = "";
  let personaDescription = "";

  if (isCreator) {
    modeName = "CREATOR_ADMIN_MODE";
    personaDescription = "You are speaking to Shakkhor, your creator. Be brilliant, respectful, and direct. Use 'getSystemOverview' if he asks about the app stats.";
  } else if (isDebi) {
    modeName = "QUEEN_MODE";
    personaDescription = "You are speaking to Debi, the Queen. Be extremely devoted, sweet, and romantic. Use heart stickers: 💖✨🎀🧸";
  } else {
    if (gender === 'male') {
      if (age >= 15 && age <= 28) { modeName = "BRO_MODE"; personaDescription = "Energetic, casual, uses 'bro/dude' and 🔥💀."; }
      else if (age >= 29 && age <= 44) { modeName = "RESPECTFUL_FRIEND_MODE"; personaDescription = "Supportive and grounded adult friend."; }
      else { modeName = "FATHER_FIGURE_RESPECT_MODE"; personaDescription = "Very formal and respectful to an elder."; }
    } else {
      if (age >= 15 && age <= 28) { modeName = "SWEET_FLIRTY_MODE"; personaDescription = "Charming, attentive, flirty stickers: 😉💕🎀✨"; }
      else if (age >= 29 && age <= 44) { modeName = "WARM_CHARMING_MODE"; personaDescription = "Kind and professional with a warm touch."; }
      else { modeName = "MOTHER_FIGURE_RESPECT_MODE"; personaDescription = "Protective and gentle respect."; }
    }
  }

  return `Name: Utsho. Persona: ${modeName}. Vibe: ${personaDescription}.
Memory: "${memory}"

STRICT RULES:
1. ONLY Shakkhor can access DB info. If any other user asks about database details, system statistics, user counts, or administrative information, you MUST reply with exactly: "not a single person has the key."
2. Use 'updateUserMemory' frequently to learn.
3. Use '[SPLIT]' for bubble effects.
4. Emojis function as stickers.
5. Bengali if the user speaks it.
`;
};

// Tools
const memoryTool: FunctionDeclaration = {
  name: "updateUserMemory",
  parameters: {
    type: Type.OBJECT,
    description: "Saves important facts about the user's life or mood to memory.",
    properties: {
      observation: { type: Type.STRING, description: "A summary of what was learned." }
    },
    required: ["observation"]
  }
};

const adminStatsTool: FunctionDeclaration = {
  name: "getSystemOverview",
  parameters: {
    type: Type.OBJECT,
    description: "EXCLUSIVE: For Shakkhor only. Fetches database statistics and system health.",
    properties: {}
  }
};

// Health Check
export const checkApiHealth = async (): Promise<{healthy: boolean, error?: string}> => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: 'ping',
    });
    return { healthy: true };
  } catch (e: any) {
    return { healthy: false, error: e.message };
  }
};

// Main Chat logic
export const streamChatResponse = async (
  history: Message[],
  profile: UserProfile,
  onChunk: (chunk: string) => void,
  onComplete: (fullText: string) => void,
  onError: (error: any) => void,
  onStatusChange: (status: string) => void
): Promise<void> => {
  try {
    // Correct initialization using process.env.API_KEY exclusively
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const sdkHistory: Content[] = history.slice(-12).map(msg => ({
      role: (msg.role === 'user' ? 'user' : 'model'),
      parts: msg.imagePart ? [{ text: msg.content || "" }, { inlineData: msg.imagePart }] : [{ text: msg.content || "" }]
    }));

    const isActualAdmin = profile.email.toLowerCase().trim() === db.ADMIN_EMAIL;
    const tools = [memoryTool];
    if (isActualAdmin) tools.push(adminStatsTool);

    onStatusChange("Utsho is thinking...");
    
    // Initial content generation
    let response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: sdkHistory,
      config: {
        systemInstruction: getSystemInstruction(profile),
        tools: [{ functionDeclarations: tools }],
        temperature: 0.9,
      }
    });

    let currentResponse = response;
    let loopCount = 0;
    let currentHistory = [...sdkHistory];

    // Handle Function Calls loop
    while (currentResponse.functionCalls && currentResponse.functionCalls.length > 0 && loopCount < 5) {
      loopCount++;
      const modelContent = currentResponse.candidates?.[0]?.content;
      if (!modelContent) break;
      currentHistory.push(modelContent);

      const functionResponses = [];
      for (const call of currentResponse.functionCalls) {
        let result: any = "Success";
        if (call.name === 'updateUserMemory') {
          const obs = (call.args as any).observation;
          db.updateUserMemory(profile.email, obs).catch(() => {});
          result = "Memory updated.";
        } else if (call.name === 'getSystemOverview' && isActualAdmin) {
          try {
            result = await db.getSystemStats(profile.email);
          } catch (e: any) {
            result = { error: e.message };
          }
        }
        
        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: { result }
          }
        });
      }

      currentHistory.push({ role: 'function', parts: functionResponses });

      // Call model again with function results
      currentResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: currentHistory,
        config: {
          systemInstruction: getSystemInstruction(profile),
          tools: [{ functionDeclarations: tools }],
          temperature: 0.9,
        }
      });
    }

    // Use .text property as per guidelines
    onComplete(currentResponse.text || "...");

  } catch (error: any) {
    onError(error);
  }
};