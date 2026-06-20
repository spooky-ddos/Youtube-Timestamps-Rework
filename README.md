# 🚀 YouTube Timestamps (Rework)

![Wersja](https://img.shields.io/badge/wersja-1.2.1-blue.svg)
![Licencja](https://img.shields.io/badge/licencja-Open%20Source-green.svg)

To rozszerzenie przeglądarki, które **ulepsza oglądanie YouTube**, wyświetlając znaczniki czasu z komentarzy bezpośrednio na osi czasu filmu!

<br>

## ✨ O tej wersji (Rework)

Ta wersja jest ulepszoną i zmodyfikowaną kontynuacją oryginalnego projektu [YouTube Timestamps](https://ris58h.github.io/youtube-timestamps/). Wprowadziliśmy kilka kluczowych zmian, aby poprawić jego funkcjonalność i wygodę użytkowania.

### Co nowego? 🔧

* **♾️ Wszystkie komentarze główne:** Rozszerzenie pobiera i analizuje **wszystkie komentarze nadrzędne** (top-level) pod filmem — bez limitu 100 sztuk z oryginału. Liczba widoczna na YouTube (np. 600+) obejmuje też **odpowiedzi w wątkach**; wtyczka ich nie skanuje, bo znaczniki czasu prawie zawsze są w komentarzach głównych.
* **📺 Powiadomienia na żywo:** Wyskakujące okienka (pop-upy) pojawiają się w rogu filmu, gdy odtwarzanie dotrze do momentu oznaczonego w komentarzu.
* **🔥 Mapa ciepła znaczników:** Im więcej komentarzy wskazuje ten sam moment, tym jaśniejszy znacznik na pasku czasu.
* **🔗 Szybki dostęp do komentarza:** Najedź na znacznik i naciśnij **LAlt** — film się zatrzyma, a komentarz otworzy się w nowej karcie. To samo można zrobić przez **menu kontekstowe** (PPM) → *Open in New Tab*.
* **💾 Inteligentny cache:** Pobrane znaczniki są zapamiętywane na 1 godzinę. Puste lub nieudane pobrania nie są zapisywane. Stare wpisy (> 1 tydzień) są automatycznie usuwane.
* **🧹 Czyszczenie cache z popupu:** Przycisk *Wyczyść cache tego filmu* w ustawieniach wtyczki — dostępny, gdy w aktywnej karcie jest otwarty film YouTube.
* **🐛 Tryb debugowania:** Opcjonalny switch w popupie włącza logi `[YTT]` w konsoli przeglądarki (przydatne przy diagnozie problemów).
* **🔌 Naprawione pobieranie komentarzy:** Przejście na InnerTube API w kontekście zalogowanej sesji użytkownika (działa z kontem Google na YouTube).

---

## 🎯 Główne funkcje

* **Znaczniki na osi czasu:** Wyświetla znaczniki czasu z komentarzy na pasku postępu filmu.
* **Podgląd komentarzy:** Najedź kursorem na znacznik, aby zobaczyć autora, znacznik czasu i treść komentarza.
* **LAlt → komentarz w nowej karcie:** Zatrzymaj film i otwórz wątek komentarza na YouTube jednym skrótem.
* **Menu kontekstowe:** PPM na znaczniku → otwarcie komentarza w nowej karcie.
* **Powiadomienia podczas odtwarzania:** Popup z komentarzem w momencie, do którego dotarł film.
* **Pełna kompatybilność:** Działa w trybie **pełnoekranowym**, **kinowym** oraz na **osadzonych odtwarzaczach**.
* **Wsparcie dla motywów:** Pełne wsparcie dla **ciemnego motywu** YouTube.
* **Panel ustawień:** W popupie wtyczki można włączać/wyłączać znaczniki, popupy, debug oraz czyścić cache bieżącego filmu.
* **Otwarty kod źródłowy:** Jesteśmy w pełni [Open Source](https://github.com/ris58h/youtube-timestamps)!

> **💡 Wskazówka:** Aby przewinąć długi tekst w podglądzie komentarza, najedź na znacznik czasu na osi i użyj **kółka myszy**.

---

## ⚙️ Ustawienia (popup wtyczki)

| Opcja | Opis |
|-------|------|
| **Znaczniki na pasku czasu** | Włącza / wyłącza kolorowe znaczniki na osi odtwarzania. |
| **Powiadomienia o komentarzach** | Włącza / wyłącza popupy podczas odtwarzania. |
| **Wyczyść cache tego filmu** | Usuwa zapamiętane znaczniki dla filmu w bieżącej karcie i pobiera je ponownie. Nieaktywny poza stroną `watch?v=...`. |
| **Logi debugowania** | Włącza szczegółowe logi `[YTT]` w konsoli (F12). |

---

## 📦 Instalacja (Chrome / Edge)

1. Pobierz lub sklonuj repozytorium.
2. Wejdź na `chrome://extensions` (lub `edge://extensions`).
3. Włącz **Tryb programisty**.
4. Kliknij **Załaduj rozpakowane** i wskaż folder `extension`.
5. Odśwież stronę YouTube z filmem.

---

## 🛠️ Struktura projektu

```
extension/
├── background/     # Parser znaczników czasu (logika V6)
├── content/
│   ├── content.js  # Inicjalizacja i orchestracja
│   ├── cache.js    # Cache i sprzątanie storage
│   ├── fetch.js    # Pobieranie komentarzy (InnerTube API)
│   ├── ui.js       # Znaczniki, podgląd, popupy
│   ├── page-bridge.js  # Dostęp do ytInitialData strony
│   └── content.css
└── popup/          # Panel ustawień wtyczki
```

---

## ❓ FAQ

**Dlaczego wtyczka widzi mniej komentarzy niż licznik YouTube?**  
YouTube podaje łączną liczbę komentarzy **i odpowiedzi**. Wtyczka analizuje wyłącznie **komentarze główne** — to właściwe źródło znaczników czasu.

**Znaczniki się nie pojawiają / są nieaktualne?**  
Otwórz popup wtyczki → *Wyczyść cache tego filmu* → odśwież stronę. W razie problemów włącz *Logi debugowania* i sprawdź konsolę (F12).

**Czy potrzebuję klucza API Google?**  
Nie. Wtyczka korzysta z publicznego wewnętrznego API YouTube (InnerTube), tak jak sama strona youtube.com.
