# Postman Verification Steps

1.  **Login (Get Token)**
    *   **Method:** POST
    *   **URL:** `http://localhost:8000/api/v1/auth/login`
    *   **Body (JSON):**
        ```json
        {
          "email": "your_email@example.com",
          "password": "your_password"
        }
        ```
    *   **Action:** Copy the `accessToken` from the response (or ensure your client handles the cookie).

2.  **Fetch Questions (First Run - AI Generation)**
    *   **Method:** GET
    *   **URL:** `http://localhost:8000/api/v1/questions?topic=React&limit=5&difficulty=Medium`
    *   **Headers:**
        *   `Authorization`: `Bearer <YOUR_ACCESS_TOKEN>`
    *   **Expected Result:**
        *   Status: 200 OK
        *   Time: ~3-5 seconds (AI generation time)
        *   Body: Array of 5 questions. `source` should be mostly "AI_Groq".

3.  **Fetch Questions (Second Run - Cache Hit)**
    *   **Method:** GET
    *   **URL:** `http://localhost:8000/api/v1/questions?topic=React&limit=5`
    *   **Headers:**
        *   `Authorization`: `Bearer <YOUR_ACCESS_TOKEN>`
    *   **Expected Result:**
        *   Status: 200 OK
        *   Time: < 200ms (Database fetch)
        *   Body: Array of 5 questions.
