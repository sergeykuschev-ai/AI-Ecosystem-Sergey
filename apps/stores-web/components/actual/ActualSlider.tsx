"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type UIEvent,
} from "react";
import type { ActualItem, ActualItemType } from "@/types/actual-item";
import type { Brand } from "@/types/brand";

const AUTOPLAY_INTERVAL_MS = 6_500;
const INTERACTION_PAUSE_MS = 12_000;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const typeLabels: Record<ActualItemType, string> = {
  promotion: "Акция",
  announcement: "Объявление",
  vacancy: "Вакансия",
  bonus: "Бонусная программа",
  general: "Важное",
};

function subscribeToReducedMotion(callback: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getReducedMotionSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function useReducedMotion() {
  return useSyncExternalStore(subscribeToReducedMotion, getReducedMotionSnapshot, () => true);
}

interface ActualSliderProps {
  items: ActualItem[];
  brands: Pick<Brand, "id" | "name" | "primary_color" | "secondary_color">[];
}

function ActualSlideImage({ item, index, onInteraction }: { item: ActualItem; index: number; onInteraction: () => void }) {
  if (!item.image) return null;

  const image = (
    <Image
      src={item.image}
      alt={item.imageAlt ?? item.title}
      fill
      sizes="(min-width: 1152px) 1152px, calc(100vw - 2rem)"
      priority={index === 0}
    />
  );

  return item.buttonUrl ? (
    <Link
      className="actual-slide__visual"
      href={item.buttonUrl}
      aria-label={`Открыть материал «${item.title}»`}
      onClick={onInteraction}
    >
      {image}
    </Link>
  ) : (
    <div className="actual-slide__visual">{image}</div>
  );
}

export function ActualSlider({ items, brands }: ActualSliderProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedMotion = useReducedMotion();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTemporarilyPaused, setIsTemporarilyPaused] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);

  const pauseTemporarily = useCallback(() => {
    setIsTemporarilyPaused(true);
    if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
    pauseTimeoutRef.current = setTimeout(() => {
      setIsTemporarilyPaused(false);
      pauseTimeoutRef.current = null;
    }, INTERACTION_PAUSE_MS);
  }, []);

  const scrollToItem = useCallback(
    (index: number, initiatedByUser = false) => {
      const viewport = viewportRef.current;
      const slide = viewport?.querySelector<HTMLElement>(`[data-slide-index="${index}"]`);
      if (!viewport || !slide) return;

      if (initiatedByUser) pauseTemporarily();
      viewport.scrollTo({ left: slide.offsetLeft, behavior: reducedMotion ? "auto" : "smooth" });
      setCurrentIndex(index);
    },
    [pauseTemporarily, reducedMotion],
  );

  const move = useCallback(
    (direction: -1 | 1, initiatedByUser = true) => {
      const nextIndex = (currentIndex + direction + items.length) % items.length;
      scrollToItem(nextIndex, initiatedByUser);
    },
    [currentIndex, items.length, scrollToItem],
  );

  useEffect(() => {
    return () => {
      if (pauseTimeoutRef.current) clearTimeout(pauseTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const isPaused = reducedMotion || isTemporarilyPaused || isHovering || isFocusWithin;
    if (isPaused || items.length < 2) return;

    const interval = window.setInterval(() => move(1, false), AUTOPLAY_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [isFocusWithin, isHovering, isTemporarilyPaused, items.length, move, reducedMotion]);

  useEffect(() => {
    const handleResize = () => scrollToItem(currentIndex);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [currentIndex, scrollToItem]);

  if (!items.length) return null;

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget;
    const slides = Array.from(viewport.querySelectorAll<HTMLElement>("[data-slide-index]"));
    let closestIndex = currentIndex;
    let closestDistance = Number.POSITIVE_INFINITY;

    slides.forEach((slide, index) => {
      const distance = Math.abs(slide.offsetLeft - viewport.scrollLeft);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    if (closestIndex !== currentIndex) setCurrentIndex(closestIndex);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      move(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      move(1);
    }
  };

  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsFocusWithin(false);
  };

  return (
    <section
      className="actual-section"
      aria-labelledby="actual-title"
      aria-roledescription="carousel"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onFocusCapture={() => setIsFocusWithin(true)}
      onBlurCapture={handleBlur}
    >
      <div className="actual-section__header">
        <div>
          <p className="eyebrow">В центре внимания</p>
          <h2 id="actual-title">Актуальное</h2>
        </div>
        {items.length > 1 && (
          <div className="actual-slider__arrows" aria-label="Управление слайдером">
            <button type="button" onClick={() => move(-1)} aria-label="Предыдущий слайд">
              <span aria-hidden="true">←</span>
            </button>
            <button type="button" onClick={() => move(1)} aria-label="Следующий слайд">
              <span aria-hidden="true">→</span>
            </button>
          </div>
        )}
      </div>

      <div
        ref={viewportRef}
        className="actual-slider__viewport"
        tabIndex={0}
        aria-label="Материалы раздела «Актуальное». Используйте стрелки влево и вправо для навигации."
        aria-live={isTemporarilyPaused || isFocusWithin ? "polite" : "off"}
        onKeyDown={handleKeyDown}
        onPointerDown={pauseTemporarily}
        onScroll={handleScroll}
      >
        {items.map((item, index) => {
          const brand = brands.find((candidate) => candidate.id === item.brandId);
          const style = {
            "--slide-accent": brand?.primary_color ?? "#183153",
            "--slide-soft": brand?.secondary_color ?? "#edf2f7",
          } as CSSProperties;

          return (
            <article
              className="actual-slide"
              data-slide-index={index}
              key={item.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} из ${items.length}`}
              style={style}
            >
              <ActualSlideImage item={item} index={index} onInteraction={pauseTemporarily} />
              <div className="actual-slide__content">
                <div className="actual-slide__meta">
                  <span className="actual-slide__type">{typeLabels[item.type]}</span>
                  {item.badge && <span className="actual-slide__badge">{item.badge}</span>}
                  {brand && <span className="actual-slide__brand">{brand.name}</span>}
                </div>
                <h3>{item.title}</h3>
                {item.shortText && <p>{item.shortText}</p>}
                {item.buttonText && item.buttonUrl && (
                  <Link className="actual-slide__button" href={item.buttonUrl} onClick={pauseTemporarily}>
                    {item.buttonText} <span aria-hidden="true">→</span>
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {items.length > 1 && (
        <div className="actual-slider__dots" role="group" aria-label="Выбор слайда">
          {items.map((item, index) => (
            <button
              type="button"
              key={item.id}
              className={index === currentIndex ? "is-active" : ""}
              aria-label={`Перейти к слайду ${index + 1}`}
              aria-current={index === currentIndex ? "true" : undefined}
              onClick={() => scrollToItem(index, true)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
