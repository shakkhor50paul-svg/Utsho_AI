
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Message } from "../types";

const SYSTEM_INSTRUCTION = `You are a helpful, creative, and clever AI assistant powered by Gemini. 
Your goal is to provide accurate and helpful information while maintaining a professional yet friendly tone.
Use markdown for formatting when appropriate (lists, code blocks, bold text).
If you are asked to write code, always specify the language for syntax highlighting.`;

export const streamChatResponse = async (
  history: Message[],
  onChunk: (chunk: string) => void,
  onComplete: (fullText: string) => void,
  onError: (error: any) => void
) => {
  try {
    // Initialize GoogleGenAI inside the function to ensure we always use the latest API key from the environment.
    // The apiKey must be obtained exclusively from process.env.API_KEY.
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    const chat = ai.chats.create({
      model: 'gemini-3-flash-preview',
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
      },
    });

    // We'll use the last message as the prompt for the conversation turn.
    const lastUserMessage = history[history.length - 1].content;
    
    // sendMessageStream accepts a 'message' property containing the prompt.
    const streamResponse = await chat.sendMessageStream({ message: lastUserMessage });
    
    let fullText = '';
    for await (const chunk of streamResponse) {
      const c = chunk as GenerateContentResponse;
      // Access the .text property directly as per SDK guidelines (not a method call).
      const text = c.text || '';
      fullText += text;
      onChunk(text);
    }
    
    onComplete(fullText);
  } catch (error) {
    console.error("Gemini API Error:", error);
    onError(error);
  }
};