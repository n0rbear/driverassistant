# Server infrastructure plan

## 1. Cél

A jelenlegi Driver Assistant backend és adatbázis stabil, ingyenes vagy közel ingyenes üzemeltetése addig, amíg a rendszer el nem éri azt a felhasználószámot és bevételi szintet, amikor már indokolt saját VPS-re költözni.

A kezdeti infrastruktúra célja:

- a Driver Assistant folyamatos fejlesztésének biztosítása;
- az adatbázis tartós megőrzése;
- a későbbi AI Platform alapjainak előkészítése;
- minimális vagy nulla havi költség;
- egyszerű migrálhatóság saját szerverre;
- minden alkalmazás és webes felület központi rendszerbe szervezése;
- a fejlesztési dokumentáció kötelező használata minden későbbi módosításnál.

---

## 2. Jelenlegi állapot

### GitHub

Repository:

```text
n0rbear/driverassistant
```

Jelenlegi backend fájlok:

```text
package.json
server.js
```

A Render közvetlenül a GitHub repository `main` ágából telepíti a backend legfrissebb verzióját.

### Render

Jelenlegi szolgáltatások:

```text
driverassistant
├── Node.js web service
└── PostgreSQL database
```

Régió:

```text
Frankfurt
```

Állapot:

```text
Backend: Deployed
Database: Available
```

---

## 3. Rövid távú célarchitektúra

```text
GitHub
│
├── driverassistant repository
│   ├── server.js
│   ├── package.json
│   ├── server.md
│   └── későbbi modulok
│
└── automatikus deploy
        │
        ▼
Render
│
├── Driver Assistant API
├── későbbi AI Gateway
├── későbbi Auth API
├── későbbi License API
└── későbbi Admin Web
        │
        ▼
Supabase PostgreSQL
│
├── Driver Assistant adatok
├── felhasználók
├── licencek
├── alkalmazás-konfigurációk
├── AI használati adatok
└── naplók és audit adatok
```

A Render feladata a futó backend szolgáltatások kiszolgálása.

A Supabase feladata a tartós PostgreSQL adatbázis biztosítása.

---

## 4. Miért kell leváltani a Render PostgreSQL adatbázist?

A Render ingyenes PostgreSQL csomagja nem tekinthető hosszú távú, tartós adatbázis-megoldásnak.

A backend Renderen maradhat, de az adatokat olyan PostgreSQL szolgáltatásba kell áthelyezni, amely:

- nem rövid tesztidőre készült;
- támogatja a külső PostgreSQL kapcsolatot;
- rendelkezik mentési lehetőséggel;
- később egyszerűen migrálható saját VPS-re;
- kompatibilis a jelenlegi Node.js backenddel.

A kiválasztott ideiglenes adatbázis-szolgáltatás:

```text
Supabase PostgreSQL
```

---

## 5. Migrációs terv

### 5.1. Supabase projekt létrehozása

Létre kell hozni egy új Supabase projektet.

Ajánlott név:

```text
ai-platform
```

vagy:

```text
driverassistant-production
```

Ajánlott régió:

```text
Frankfurt vagy más közeli európai régió
```

A létrehozáskor biztonságos adatbázis-jelszót kell beállítani.

A jelszót nem szabad:

- GitHub repositoryba feltölteni;
- `server.js` fájlba beírni;
- képernyőképen nyilvánosan megosztani;
- kliensalkalmazásba beépíteni.

---

### 5.2. Kapcsolati adatok

A Supabase projektből szükség lesz a PostgreSQL kapcsolati karakterláncra.

Példa:

```text
postgresql://USER:PASSWORD@HOST:PORT/DATABASE
```

A kapcsolati karakterláncot a Render környezeti változói között kell tárolni.

Ajánlott változónév:

```text
DATABASE_URL
```

---

### 5.3. Adatbázis-séma feltérképezése

Migráció előtt dokumentálni kell:

- az összes táblát;
- az oszlopokat és adattípusokat;
- az elsődleges kulcsokat;
- az idegen kulcsokat;
- az indexeket;
- az alapértelmezett értékeket;
- az egyedi megszorításokat;
- a JSONB mezőket;
- a soft delete mezőket;
- az időbélyegeket;
- a migrációs vagy inicializáló SQL kódot.

Kiemelten ellenőrizendő táblák és adatok:

```text
users
drivers
tours
stops
depots
work_times
costs
locations
status
sync metadata
soft delete fields
updatedAt fields
UUID fields
items JSONB fields
```

A tényleges táblaneveket a jelenlegi `server.js` és adatbázis alapján kell pontosítani.

---

### 5.4. Adatbázis-export

A jelenlegi Render PostgreSQL adatbázisról teljes mentést kell készíteni.

Ajánlott formátum:

```text
PostgreSQL custom dump
```

Példa:

```bash
pg_dump --format=custom --no-owner --no-acl "$OLD_DATABASE_URL" > driverassistant.dump
```

Alternatív SQL formátum:

```bash
pg_dump --no-owner --no-acl "$OLD_DATABASE_URL" > driverassistant.sql
```

A dump fájlt biztonságosan kell tárolni, és nem szabad nyilvános GitHub repositoryba feltölteni.

---

### 5.5. Adatbázis-import Supabase-be

Custom dump esetén:

```bash
pg_restore   --no-owner   --no-acl   --clean   --if-exists   --dbname="$NEW_DATABASE_URL"   driverassistant.dump
```

SQL dump esetén:

```bash
psql "$NEW_DATABASE_URL" < driverassistant.sql
```

Az import után ellenőrizni kell:

- táblák száma;
- rekordok száma;
- indexek;
- idegen kulcsok;
- UUID mezők;
- JSONB mezők;
- dátum- és időmezők;
- speciális PostgreSQL extensionök.

---

### 5.6. Render backend átállítása

A Render web service környezeti változói között a jelenlegi adatbázis-kapcsolatot le kell cserélni.

Régi:

```text
DATABASE_URL=<Render PostgreSQL URL>
```

Új:

```text
DATABASE_URL=<Supabase PostgreSQL URL>
```

Ezután manuális újratelepítés szükséges:

```text
Manual Deploy
→ Deploy latest commit
```

---

### 5.7. Migráció utáni tesztek

A régi adatbázist nem szabad azonnal törölni.

Először teljes funkcionális tesztet kell végezni.

Ellenőrzendő:

- backend indulása;
- health endpoint;
- bejelentkezés;
- sofőrök lekérése;
- túrák lekérése;
- túra létrehozása;
- túra módosítása;
- túra törlése;
- soft delete;
- megállók mentése;
- depó kezelése;
- hotel jelölések;
- munkaidők;
- költségek;
- GPS-adatok;
- státuszok;
- Android szinkronizáció;
- webes dashboard;
- dátumkezelés;
- éjszakán átnyúló műszak;
- last-writer-wins logika;
- `updatedAt` kezelés;
- UUID-alapú szinkronizáció;
- JSONB `items` mező.

Legalább 48–72 órás stabil teszt után lehet a régi adatbázis megszüntetéséről dönteni.

---

## 6. Biztonsági alapelvek

### Titkos adatok

Az alábbi értékeket csak környezeti változóban szabad tárolni:

```text
DATABASE_URL
JWT_SECRET
ADMIN_PASSWORD
API_KEYS
SUPABASE_KEYS
SMTP_PASSWORD
ENCRYPTION_KEY
```

### GitHub

A `.gitignore` fájlban szerepeljen:

```text
.env
.env.*
*.key
*.pem
*.dump
*.sql
backups/
secrets/
```

A repositoryban csak példa-konfiguráció szerepelhet:

```text
.env.example
```

Példa:

```env
PORT=3000
DATABASE_URL=
JWT_SECRET=
NODE_ENV=production
```

---

## 7. Adatbázis-hozzáférési modell

A backend kizárólag szerveroldali PostgreSQL-kapcsolaton keresztül érje el az adatbázist.

Az Android alkalmazás és a webes kliens:

```text
nem kapcsolódhat közvetlenül az adatbázishoz
```

Helyes adatfolyam:

```text
Android / Web
      │
      ▼
Backend API
      │
      ▼
PostgreSQL
```

Minden ügyféladatot a backend jogosultságkezelése védjen.

Hosszú távú cél:

- ügyfelenként elkülönített adatok;
- szerepkörök;
- admin, ügyfél és sofőr jogosultságok;
- audit napló;
- titkosított érzékeny adatok;
- ügyfél által megadott opcionális titkosítási jelszó;
- világos figyelmeztetés arra, hogy elveszett, nem visszaállítható titkosítási kulcs esetén az adatok nem állíthatók helyre.

---

## 8. Mentési terv

### Napi mentés

Később automatikus napi PostgreSQL mentést kell bevezetni.

Fájlnév:

```text
driverassistant-YYYY-MM-DD-HHMM.dump
```

Megőrzési szabály:

```text
napi mentések: 7 nap
heti mentések: 4 hét
havi mentések: 6–12 hónap
```

### Mentések tárolása

Lehetséges célok:

```text
Cloudflare R2
Google Drive
S3-kompatibilis tárhely
saját VPS háttértár
titkosított helyi mentés
```

A mentéseknek titkosítottnak kell lenniük.

---

## 9. Monitorozás

A backendhez kötelező health endpoint:

```text
GET /health
```

Ajánlott válasz:

```json
{
  "status": "ok",
  "database": "connected",
  "timestamp": "2026-07-12T18:00:00.000Z",
  "version": "1.0.0"
}
```

Később hozzáadandó:

- uptime monitor;
- hibalogok;
- adatbázis-kapcsolati hibák;
- API válaszidők;
- sikertelen belépések;
- szinkronizációs hibák;
- tárhelyhasználat;
- adatbázisméret;
- felhasználószám;
- API-kérések száma.

---

## 10. Render szolgáltatások tervezett felosztása

Kezdetben:

```text
driverassistant-api
```

Később:

```text
ai-gateway
auth-service
license-service
driverassistant-api
keto-api
admin-web
public-web
```

Nem kell mindent azonnal külön szolgáltatásra bontani.

Kezdetben érdemes egy jól strukturált moduláris backenddel dolgozni, majd csak indokolt esetben mikroszolgáltatásokra bontani.

---

## 11. Repository-struktúra rövid távon

A jelenlegi repositoryban:

```text
driverassistant/
│
├── server.js
├── package.json
├── package-lock.json
├── server.md
├── .env.example
├── .gitignore
├── README.md
│
├── src/
│   ├── config/
│   ├── database/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   ├── repositories/
│   ├── utils/
│   └── app.js
│
├── migrations/
├── scripts/
├── tests/
└── docs/
```

A jelenlegi nagy `server.js` fájlt később fokozatosan szét kell bontani.

A bontást csak stabil mentés és működő tesztek után szabad elkezdeni.

---

## 12. Központi AI Platform hosszú távú szerkezete

```text
ai-platform/
│
├── apps/
│   ├── driverassistant-api/
│   ├── keto-api/
│   ├── auth-service/
│   ├── license-service/
│   ├── ai-gateway/
│   ├── admin-web/
│   └── public-web/
│
├── packages/
│   ├── database/
│   ├── auth/
│   ├── logging/
│   ├── validation/
│   ├── shared-types/
│   └── ui/
│
├── infrastructure/
│   ├── render/
│   ├── docker/
│   ├── backups/
│   └── migrations/
│
├── docs/
│   ├── MASTER_SPEC.md
│   ├── SERVER.md
│   ├── DATABASE.md
│   ├── SECURITY.md
│   └── DEPLOYMENT.md
│
└── README.md
```

---

## 13. Kötelező fejlesztési szabály

Minden jövőbeli fejlesztés előtt kötelező elolvasni:

```text
MASTER_SPEC.md
server.md
```

Minden fejlesztői agentnek vagy AI-eszköznek meg kell adni:

```text
A módosítás megkezdése előtt olvasd el teljes egészében a MASTER_SPEC.md és server.md fájlokat. A fájlokban rögzített architektúrától, biztonsági szabályoktól és migrációs elvektől csak kifejezett engedéllyel térhetsz el.
```

---

## 14. Saját VPS-re költözés feltételei

Saját VPS akkor indokolt, amikor legalább egy teljesül:

- az ingyenes szolgáltatások korlátai akadályozzák a működést;
- a cold start elfogadhatatlan;
- stabil, folyamatos háttérfolyamatok szükségesek;
- a felhasználók száma jelentősen nő;
- bevétel keletkezik;
- több alkalmazás fut párhuzamosan;
- saját Docker Compose környezet szükséges;
- saját reverse proxy szükséges;
- teljes adatbázis-felügyelet szükséges;
- költségben kedvezőbbé válik egy VPS.

A felhasználószám önmagában nem döntő.

A költözés technikai feltétele:

- Docker-kompatibilis backend;
- szabványos PostgreSQL;
- dokumentált környezeti változók;
- rendszeres dump;
- automatikus migrációk;
- elkülönített fájltárolás.

---

## 15. Első végrehajtási szakasz

### 1. lépés

A `server.md` elhelyezése a GitHub repository gyökerében.

### 2. lépés

A jelenlegi Render PostgreSQL adatbázis adatainak és lejárati állapotának ellenőrzése.

### 3. lépés

Supabase projekt létrehozása.

### 4. lépés

A jelenlegi adatbázis teljes mentése.

### 5. lépés

Import a Supabase PostgreSQL adatbázisba.

### 6. lépés

A Render `DATABASE_URL` módosítása.

### 7. lépés

Teljes backend és Android szinkronizációs teszt.

### 8. lépés

Automatikus mentési rendszer megtervezése.

### 9. lépés

A `server.js` biztonságos, fokozatos modularizálása.

### 10. lépés

A központi AI Platform első szolgáltatásának megtervezése.

---

## 16. Következő konkrét feladat

A következő munkafázisban először a jelenlegi Render PostgreSQL adatbázis pontos állapotát kell felmérni.

Szükséges adatok:

- adatbázis csomag típusa;
- létrehozás dátuma;
- lejárati vagy fizetési figyelmeztetés;
- adatbázis mérete;
- kapcsolati adatok helye;
- exportálási lehetőség;
- jelenlegi táblák;
- jelenlegi rekordmennyiség.

Ezek alapján döntjük el, hogy azonnali migráció szükséges-e, vagy előbb a mentési és tesztelési folyamatot készítjük elő.
