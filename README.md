# PillFlow 💊

Умно приложение за следене на медикаменти и хранителни добавки.

- Дневен чеклист с условия (на гладно, с храна, време на деня)
- Календар с прогрес
- Периодичност: всеки ден, през ден, конкретни дни, курсове
- Реално време синхронизация чрез Firebase (Auth + Firestore)
- Работи на телефон и лаптоп

## Бърз старт (локално)

1. Клонирай репото
2. Отвори `index.html` или пусни локален сървър:
   ```bash
   python3 -m http.server 8080
   ```
3. За облачна синхронизация → следвай секцията **Firebase** по-долу

## Firebase (облачна синхронизация в реално време)

Всичко се синхронизира **мигновено** – няма бутони „Запази“ или „Свали“.  
Данните са вързани към акаунта и са достъпни от всяко устройство.

### Стъпка по стъпка

#### 1. Създай Firebase проект
1. Отиди на [https://console.firebase.google.com](https://console.firebase.google.com)
2. Натисни **Add project** → дай име (напр. `pillflow`)
3. Изключи Google Analytics ако не ти трябва → **Create project**

#### 2. Добави Web приложение
1. В Project Overview натисни иконката **</>** (Web)
2. Дай nickname (напр. `pillflow-web`)
3. **Не** отмятай Firebase Hosting засега
4. Копирай обекта `firebaseConfig` (apiKey, authDomain, projectId и т.н.)

#### 3. Активирай Authentication
1. В лявото меню → **Build** → **Authentication**
2. **Get started**
3. Таб **Sign-in method** → **Email/Password** → Enable → Save

#### 4. Създай Firestore Database
1. **Build** → **Firestore Database**
2. **Create database**
3. Избери **Start in test mode** (за начало) → избери локация (europe-west...) → Enable

> По-късно сложи правилните Security Rules (виж по-долу).

#### 5. Попълни конфигурацията в проекта
1. Копирай `firebase-config.example.js` → `firebase-config.js`
2. Попълни стойностите от Firebase Console
3. Отвори `index.html` и се увери, че скриптът зарежда `firebase-config.js`

#### 6. Security Rules (важно!)
В Firestore → **Rules** сложи това (за да може всеки потребител да чете/пише **само своите** данни):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Натисни **Publish**.

#### 7. Готово!
Отвори приложението → Регистрирай се → добавяй медикаменти.  
Всичко се записва и синхронизира автоматично в реално време.

## Структура на данните в Firestore

```
users/
  {uid}/
    meds/
      {medId}/          ← документ с полетата на медикамента
    logs/
      {YYYY-MM-DD}/     ← документ: { "medId_time": true, ... }
```

## GitHub Pages (по желание)

1. Settings → Pages → Source: Deploy from branch → `main` / root
2. След 1-2 минути ще имаш линк: `https://YOUR_USERNAME.github.io/pillflow`

## Технологии
- Vanilla JS + Tailwind CSS (CDN)
- Firebase Auth + Firestore (real-time)
