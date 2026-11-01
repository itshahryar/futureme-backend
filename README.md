# FutureMe — AI-Powered Career Readiness & Adaptive Learning Platform

## 1. Project Overview
**FutureMe** is an intelligent, student-centric career development and learning platform designed to bridge the gap between academic education and industry demands. 

The platform evaluates a student's current profile, verified skills, and career aspirations, then leverages AI to generate personalized, topic-by-topic learning roadmaps with built-in interactive assessments, real-time progress tracking, and automated skill reassessments.

---

## 2. End-to-End Platform Flow

### Phase 1: Authentication & Role Setup
* **User Access**: Students and administrators sign in securely via JWT authentication with HTTP-only cookies.
* **Role-Based Workspaces**:
  * **Admin**: Configures university catalogs (degrees, skills, interest domains) and customizable onboarding steps.
  * **Student**: Accesses a personalized dashboard, career onboarding wizard, and interactive profile manager.

### Phase 2: Profile Building & Career Targeting
* **Multi-Step Onboarding**:
  * Captures academic background (institution, degree, graduation timeline, GPA).
  * Records past experiences, portfolio projects, and certifications.
* **Skill Inventory & Proficiency**:
  * Students select skills from verified catalogs or add custom technical/soft skills.
  * Each skill is tagged with initial self-reported proficiency (`Beginner`, `Intermediate`, `Advanced`).
* **Prioritized Preferences & Goals**:
  * Students designate **Primary** and **Secondary** work preferences (`Remote`, `Hybrid`, `Onsite`).
  * Students select up to 3 interest domains and target career roles (e.g., *Frontend Developer*, *AI/ML Engineer*), clearly designated by priority.
  * Students define short-term targets (6–12 months) and long-term career visions (3–5 years).

### Phase 3: AI Skill Analysis & Gap Identification
* **Intelligent Profile Audit**:
  * The system compares the student's current skill set, proficiency levels, projects, and academic background against industry benchmarks for their **Primary Target Role**.
* **Skill Gap Identification**:
  * Categorizes competencies into:
    * **Proficient Skills**: Existing skills that meet role criteria.
    * **Skills to Upgrade**: Existing skills requiring deeper mastery.
    * **Missing Required Skills**: Key technologies or concepts missing from the student’s profile.

### Phase 4: AI Learning Path & Roadmap Generation
* **Personalized Milestone Generation**:
  * AI creates a step-by-step, milestone-driven learning roadmap customized to the student's timeline and goals.
* **Topic & Subtopic Modular Breakdown**:
  * Each missing or upgradeable skill is decomposed into progressive, bite-sized topics and subtopics (from foundational theory to real-world application).

### Phase 5: Content Delivery & Curated Resources
* **Targeted Learning Content**:
  * Explanations, architectural breakdowns, code snippets, and conceptual guides for each topic.
* **Curated Learning Resources**:
  * Recommended high-quality external resources (official documentation, vetted tutorials, interactive sandbox links, and academic articles).

### Phase 6: Quizzes & Interactive Assessments
* **Post-Topic Knowledge Checks**:
  * Contextual quizzes and practical challenges presented after completing each topic or subtopic.
* **Instant Evaluation**:
  * Immediate feedback with detailed explanations for incorrect answers to reinforce mastery.

### Phase 7: Real-Time Progress Tracking
* **Learning Analytics Dashboard**:
  * Visual progress bars tracking completed subtopics, milestones, and assessment scores.
* **Dynamic Profile Strength**:
  * Profile strength gauge and milestone checklists update automatically as learning activities are completed.

### Phase 8: AI Skill Reassessment & Profile Elevation
* **Competency Validation**:
  * Once a learning module is mastered and assessments are passed, the AI reassesses student performance.
* **Automatic Profile Synchronization**:
  * Verified skills and elevated proficiency levels (e.g., from `Beginner` to `Intermediate`) are automatically written to the student's permanent profile and PostgreSQL database.
* **Next-Stage Progression**:
  * The learning roadmap adapts dynamically based on updated competency levels.
