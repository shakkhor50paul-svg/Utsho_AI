
/**
 * Generates an image using Pollinations.ai (Completely Free, No API Key).
 * @param prompt The prompt for the image generation.
 * @returns Base64 encoded image data or null if failed.
 */
export const generateImage = async (prompt: string): Promise<string | null> => {
  try {
    // Pollinations uses a simple URL structure: https://image.pollinations.ai/prompt/{prompt}
    // We add some parameters for better quality and consistency.
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&enhance=true&seed=${Math.floor(Math.random() * 1000000)}`;

    // We fetch the image and convert it to base64 so it can be handled like the previous version
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error("Failed to fetch image from Pollinations");

    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("IMAGE_SERVICE: Error generating image:", error);
    return null;
  }
};
