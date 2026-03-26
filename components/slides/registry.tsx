import type { Slide } from "@/schemas/slideSchema";

import TitleSlide from "./TitleSlide";
import ContentSlide from "./ContentSlide";
import EndSlide from "./EndSlide";
import ImageSlide from "./ImageSlide";
import TwoColumnSlide from "./TwoColumnSlide";
import ThreeColumnSlide from "./ThreeColumnSlide";
import CardsSlide from "./CardsSlide";
import QuoteSlide from "./QuoteSlide";
import StatsSlide from "./StatsSlide";

/**
 * Renders a slide by type.
 *
 * To add a new slide type:
 *   1. Add a Zod schema to schemas/slideSchema.ts
 *   2. Create the component in components/slides/
 *   3. Add a case below — TypeScript will error if you miss this step
 */
export function renderSlide(slide: Slide): React.ReactNode {
  switch (slide.type) {
    case "title":
      return <TitleSlide {...slide} />;
    case "content":
      return <ContentSlide {...slide} />;
    case "end":
      return <EndSlide {...slide} />;
    case "image":
      return <ImageSlide {...slide} />;
    case "two-column":
      return <TwoColumnSlide {...slide} />;
    case "three-column":
      return <ThreeColumnSlide {...slide} />;
    case "cards":
      return <CardsSlide {...slide} />;
    case "quote":
      return <QuoteSlide {...slide} />;
    case "stats":
      return <StatsSlide {...slide} />;
  }
}
