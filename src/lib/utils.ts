import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export async function savePDF(doc: any, filename: string) {
  // Standard save works in most modern browsers
  // However, on some mobile browsers (especially in iframes), we need extra care
  try {
    // For mobile devices, sometimes outputting a blob and creating a URL works better
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    if (isMobile) {
      // Try blob approach
      const pdfBlob = doc.output("blob");
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      
      // Some mobile browsers need the link to be in the document
      document.body.appendChild(link);
      link.click();
      
      // Clean up
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
    } else {
      // Desktop default
      doc.save(filename);
    }
  } catch (err) {
    console.error("PDF generation failed, falling back to standard save", err);
    doc.save(filename);
  }
}
