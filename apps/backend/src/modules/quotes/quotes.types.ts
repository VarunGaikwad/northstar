export type QuoteCategory = "wisdom" | "life" | "work" | "courage" | "happiness";

export type Quote = {
  text: string;
  author: string;
  category?: QuoteCategory;
};

export type QuoteResponse = {
  date: string; // yyyy-mm-dd (UTC)
  index: number; // 0-based position in the list
  quote: Quote;
};
