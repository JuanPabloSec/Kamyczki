# Kamyczki 🪨

Aplikacja webowa do zabawy w **malowane kamyczki** — w duchu grupy Facebook [#kamyczki](https://www.facebook.com/groups/555702945342044/).

Malujesz kamień, dodajesz go do kolekcji ze zdjęciem, dostajesz unikalny kod, zostawiasz w terenie i oznaczasz miejsce na mapie. Inni mogą zaznaczyć, gdzie kamyczek znaleźli i skąd wyruszył dalej.

## Funkcje

| Sekcja | Co robi |
|--------|---------|
| **Konto** | Rejestracja i logowanie (JWT) |
| **Kolekcja** | Upload zdjęć namalowanych kamyczków + unikalny kod `KAM-XXXXXX` |
| **Mapa** | OpenStreetMap / Leaflet — oznaczanie „zostawiłem” i „znalazłem” |
| **Śledzenie** | Historia podróży kamyczka po kodzie |
| **Aktualności** | Ostatnie zostawienia i znalezienia społeczności |

## Wymagania

- Node.js 18+

## Uruchomienie

```bash
npm install
npm start
```

Otwórz w przeglądarce: [http://localhost:3000](http://localhost:3000)

Tryb deweloperski (auto-restart):

```bash
npm run dev
```

## Jak korzystać (zasady zabawy)

1. **Załóż konto** (opcjonalnie kod pocztowy i miasto — jak na kamyczkach w grupie FB).
2. **Namaluj kamyczek**, zrób zdjęcie i dodaj do **Kolekcji** — aplikacja wygeneruje kod.
3. Na odwrocie kamienia napisz kod (np. `KAM-AB12CD`) i `#kamyczki`.
4. **Ukryj** kamyczek w ciekawym miejscu i kliknij mapę → „Zostawiłem”.
5. Gdy ktoś **znajdzie** kamyczek: zdjęcie, kod na mapie → „Znalazłem”, potem puszcza dalej.

## API (skrót)

- `POST /api/auth/register` — rejestracja  
- `POST /api/auth/login` — logowanie  
- `GET /api/auth/me` — profil (Bearer token)  
- `GET/POST /api/stones` — kolekcja (POST z `multipart`: `photo`, `name`, `description`)  
- `GET /api/stones/code/:code` — kamyczek + podróż  
- `GET/POST /api/map/spots` — punkty na mapie (`type`: `left` \| `found`, `lat`, `lng`, opcjonalnie `code` / `stoneId`, `photo`)  
- `GET /api/map/feed` — ostatnia aktywność  

## Struktura

```
Kamyczki/
├── server/           # Express API
│   ├── index.js
│   ├── db.js         # JSON file storage
│   ├── auth.js
│   └── routes/
├── public/           # frontend SPA
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── uploads/      # zdjęcia (gitignored)
├── data/             # baza JSON (gitignored)
└── package.json
```

Dane użytkowników, kamyczków i punktów mapy są w `data/db.json`. Zdjęcia w `public/uploads/`.

## Bezpieczeństwo (produkcja)

Ustaw własny sekret JWT:

```bash
# Windows PowerShell
$env:JWT_SECRET="twoj-dlugi-losowy-sekret"
npm start
```

```bash
# Linux / macOS
export JWT_SECRET="twoj-dlugi-losowy-sekret"
npm start
```

## Inspiracja

[KAMYCZKI — grupa oryginalna na Facebooku](https://www.facebook.com/groups/555702945342044/) — malowanie kamieni, ukrywanie w terenie i śledzenie ich losów.

## Licencja

MIT
