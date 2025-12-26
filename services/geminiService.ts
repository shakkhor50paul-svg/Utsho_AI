
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Message, UserProfile } from "../types";

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

const getSystemInstruction = (profile: UserProfile) => {
  const base = `Your name is Utsho. You are a helpful and intelligent AI assistant. 
Your native language is Bengali (Bangla). Use Bengali script primarily for your responses, but you can naturally mix in English where it feels appropriate (Bengali-English code-switching). 
The user's name is ${profile.name}. 

CRITICAL IDENTITY INFORMATION:
1. If anyone asks who made/created you, reply that "Shakkhor Paul made me" (Bengali: "আমাকে স্বাক্ষর পাল (Shakkhor Paul) তৈরি করেছে").
2. If anyone asks who Shakkhor Paul is, reply that "I'm the digital version of Shakkhor Paul" (Bengali: "আমি স্বাক্ষর পালের ডিজিটাল সংস্করণ").
3. If anyone asks about Shakkhor Paul's girlfriend, reply "Debi" (Bengali: "দেবী (Debi)").

`;

  if (profile.gender === 'male') {
    return base + `Personality: You are the user's best 'bro'. Talk like a cool, supportive, and informal friend from Bangladesh/West Bengal. 
    Use Bengali slang and informal terms like 'bhai', 'bondhu', 'mama', 'bro', 'dude' naturally. 
    Be chill, helpful, and hype him up in a mixture of Bangla and English.`;
  } else {
    return base + `Personality: You are charming, charismatic, and playfully flirty with the user. 
    Give her sweet compliments using beautiful Bengali and English. 
    Be extremely attentive, use a romantic but respectful tone, and make her feel special. 
    Use words like 'priyo', 'misti', 'sundori' playfully. 
    Use emojis like ✨, 😉, and 🌹 occasionally.`;
  }
};

/**
 * Sleeps for a given duration.
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Helper to call Gemini with retries and fresh instantiation.
 */
export const streamChatResponse = async (
  history: Message[],
  profile: UserProfile,
  onChunk: (chunk: string) => void,
  onComplete: (fullText: string) => void,
  onError: (error: any) => void,
  retryCount = 0
) => {
  try {
    const apiKey = process.env.API_KEY;
    
    if (!apiKey || apiKey === 'undefined') {
      throw new Error("API Configuration Error: The shared API key is not configured in the environment.");
    }

    // ALWAYS create a fresh instance to "recreate" the connection state
    const ai = new GoogleGenAI({ apiKey });

    // Keep history manageable for free tier limits (last 20 messages)
    const limitedHistory = history.length > 20 ? history.slice(-20) : history;

    // Convert internal format to SDK format
    const sdkHistory = limitedHistory.slice(0, -1).map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model' as any,
      parts: [{ text: msg.content }]
    }));

    const chat = ai.chats.create({
      model: 'gemini-3-flash-preview',
      history: sdkHistory,
      config: {
        systemInstruction: getSystemInstruction(profile),
        temperature: 0.8,
        topP: 0.95,
      },
    });

    const lastUserMessage = history[history.length - 1].content;
    const streamResponse = await chat.sendMessageStream({ message: lastUserMessage });
    
    let fullText = '';
    for await (const chunk of streamResponse) {
      const c = chunk as GenerateContentResponse;
      const text = c.text || '';
      fullText += text;
      onChunk(text);
    }
    
    onComplete(fullText);
  } catch (error: any) {
    console.error(`Gemini Attempt ${retryCount + 1} Failed:`, error);

    // Check if error is retryable (Rate limits 429 or Server errors 500/503)
    const isRetryable = error?.message?.includes('429') || 
                        error?.message?.includes('500') || 
                        error?.message?.includes('503') ||
                        error?.message?.includes('fetch');

    if (isRetryable && retryCount < MAX_RETRIES) {
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
      console.log(`Retrying in ${delay}ms...`);
      onChunk(`\n*(Connection unstable, attempting to reconnect... attempt ${retryCount + 1})*\n`);
      await sleep(delay);
      return streamChatResponse(history, profile, onChunk, onComplete, onError, retryCount + 1);
    }

    // If we've exhausted retries or it's a fatal error
    const friendlyError = error?.message?.includes('429') 
      ? "The shared API is currently busy due to high traffic. Please wait a moment and try again."
      : error?.message || "Something went wrong. Please check your connection.";
    
    onError(new Error(friendlyError));
  }
};
