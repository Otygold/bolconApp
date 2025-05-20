// This script handles the dark mode toggle functionality for the entire site.
// It checks if dark mode was previously enabled and applies it accordingly.

document.addEventListener("DOMContentLoaded", () => {
    // Check if dark mode was previously enabled
    if (localStorage.getItem("darkMode") === "enabled") {
        document.body.classList.add("dark-mode");
    }

    // Check if we are on the account settings page where the toggle exists
    const themeToggle = document.getElementById("theme-toggle");
    if (themeToggle) {
        // Set the toggle state based on localStorage
        themeToggle.checked = document.body.classList.contains("dark-mode");

        // When the toggle is clicked, update dark mode site-wide
        themeToggle.addEventListener("change", () => {
            if (themeToggle.checked) {
                document.body.classList.add("dark-mode");
                localStorage.setItem("darkMode", "enabled");
            } else {
                document.body.classList.remove("dark-mode");
                localStorage.setItem("darkMode", "disabled");
            }
        });
    }
});