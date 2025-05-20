self.addEventListener('push', function(event) {
    const data = event.data.json();
    console.log("Push received", data);
  
    self.registration.showNotification(data.notification.title, {
      body: data.notification.body,
      icon: '/css/images/icon.png' // Optional
    });
  });