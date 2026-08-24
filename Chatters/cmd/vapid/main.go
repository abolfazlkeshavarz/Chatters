// Command vapid generates the VAPID key pair that Web Push requires.
//
//	go run ./cmd/vapid
//
// Put the output in .env: the public key is handed to browsers so they can
// subscribe, the private key signs push requests and must stay secret.
package main

import (
	"fmt"
	"log"

	webpush "github.com/SherClockHolmes/webpush-go"
)

func main() {
	private, public, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		log.Fatalf("failed to generate VAPID keys: %v", err)
	}

	fmt.Println("# Web Push (VAPID) keys — add these to your .env")
	fmt.Printf("VAPID_PUBLIC_KEY=%s\n", public)
	fmt.Printf("VAPID_PRIVATE_KEY=%s\n", private)
	fmt.Println("VAPID_SUBJECT=mailto:you@example.com")
}
